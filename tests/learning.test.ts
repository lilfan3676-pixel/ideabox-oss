// AI 自我學習：記錄修正 → 整理規則 → 套用到分析提示詞
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
process.env.ANTHROPIC_API_KEY = "k";

import { activeRules, maybeLearn, recordSignal, rulesPrompt, runLearning, LEARN_BATCH } from "@/lib/learning";
import { analyzeIdea } from "@/lib/analyze";
import type { Idea } from "@/lib/db";

let reply: Array<{ rule: string; evidence: number }> = [];
let bodies: any[] = [];

beforeEach(() => {
  reset();
  bodies = [];
  reply = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const tool = body.tools?.[0]?.name;
    const input =
      tool === "save_rules"
        ? { rules: reply }
        : { summary: "好友挑戰", category: "arx_feature", tags: ["社群"], score_arx: 8, score_feasibility: 7, score_market: 6, score_reason: "r", next_step: "n" };
    return Response.json({ content: [{ type: "tool_use", id: "t", name: tool, input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });
  });
});

const sig = (n: number, scope: "idea" | "grant" = "idea", action = "adopt") =>
  Promise.all(Array.from({ length: n }, (_, i) => recordSignal(scope, action, `r${i}`, { summary: `點子 ${i}`, category: "marketing" })));

describe("自我學習", () => {
  it("累積不到 5 筆不學習，達到就整理成規則並標成已學習", async () => {
    await sig(LEARN_BATCH - 1);
    await maybeLearn();
    expect(bodies).toHaveLength(0);

    await sig(1, "grant", "ignored");
    reply = [{ rule: "不需要付費廣告的行銷手法評分加重", evidence: 3 }];
    await maybeLearn();
    // 點子與補助各整理一次
    expect(bodies.map((b) => b.tools[0].name)).toEqual(["save_rules", "save_rules"]);
    expect(tables.feedback_signals.every((s) => s.learned)).toBe(true);
    expect(await activeRules("idea")).toEqual(["不需要付費廣告的行銷手法評分加重"]);
    expect(tables.settings.find((s) => s.key === "learning_lock")).toBeUndefined();
  });

  it("沒有新紀錄時回傳 null、不呼叫 AI", async () => {
    expect(await runLearning()).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("保留的規則更新支持數、沒列出的刪掉、使用者刪過的不會再加回來", async () => {
    tables.learned_rules.push(
      { id: 1, scope: "idea", rule: "A 規則", evidence: 2, active: true },
      { id: 2, scope: "idea", rule: "B 規則", evidence: 2, active: true },
      { id: 3, scope: "idea", rule: "被刪的規則", evidence: 4, active: false },
    );
    await sig(2);
    reply = [
      { rule: "A 規則", evidence: 4 },
      { rule: "被刪的規則", evidence: 5 },
      { rule: "C 新規則", evidence: 2 },
    ];
    const r = await runLearning();
    expect(r).toEqual({ idea: 2 });
    const rows = tables.learned_rules;
    expect(rows.find((x) => x.rule === "A 規則")!.evidence).toBe(4);
    expect(rows.find((x) => x.rule === "B 規則")).toBeUndefined();
    expect(rows.filter((x) => x.rule === "被刪的規則")).toHaveLength(1); // 仍是停用的那一筆
    expect(rows.find((x) => x.rule === "被刪的規則")!.active).toBe(false);
    expect(await activeRules("idea")).toEqual(["A 規則", "C 新規則"]);
    // 提示詞裡有告訴 AI 不要加回被刪的規則
    expect(bodies[0].system).toContain("被刪的規則");
  });

  it("AI 回傳空清單時不清掉既有規則", async () => {
    tables.learned_rules.push({ id: 1, scope: "grant", rule: "只要台中或台南的地方補助", evidence: 3, active: true });
    await sig(1, "grant", "interested");
    reply = [];
    await runLearning();
    expect(await activeRules("grant")).toEqual(["只要台中或台南的地方補助"]);
  });

  it("正在學習中（鎖還沒過期）就略過", async () => {
    tables.settings.push({ key: "learning_lock", value: String(Date.now()) });
    await sig(LEARN_BATCH);
    expect(await runLearning()).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it("規則會加進點子分析的提示詞；停用的不會", async () => {
    tables.learned_rules.push(
      { id: 1, scope: "idea", rule: "重視提高留存的社群功能", evidence: 3, active: true },
      { id: 2, scope: "idea", rule: "停用的規則", evidence: 9, active: false },
    );
    const idea = { ...(await fakeDb.from("ideas").insert({ content: "用好友挑戰提高留存" }).select().single()).data } as Idea;
    await analyzeIdea(idea);
    expect(bodies[0].system).toContain("重視提高留存的社群功能");
    expect(bodies[0].system).not.toContain("停用的規則");
  });

  it("還沒執行 migration（表不存在）時不影響分析", async () => {
    delete (tables as Record<string, unknown>).learned_rules;
    delete (tables as Record<string, unknown>).feedback_signals;
    expect(await rulesPrompt("idea")).toBe("");
    await recordSignal("idea", "adopt", "x", {});
    const idea = { ...(await fakeDb.from("ideas").insert({ content: "內容" }).select().single()).data } as Idea;
    const out = await analyzeIdea(idea);
    expect(out.status).toBe("analyzed");
    tables.learned_rules = [];
    tables.feedback_signals = [];
  });
});
