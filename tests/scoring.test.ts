// 第 2 版評分：每個專案各一分＋依評分角度換另外兩項；舊點子重評
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
process.env.ANTHROPIC_API_KEY = "k";

import { analyzeIdea } from "@/lib/analyze";
import type { Idea } from "@/lib/db";
import { scoreLine } from "@/lib/ideas";
import { rescoreBatch, rescoreStatus } from "@/lib/rescore";
import { assistantLines } from "@/lib/assistantLogic";
import { axisLabels, bestFit, cleanProjectScores, isOldScoring, lensFor, SCORING_VERSION } from "@/lib/scoring";

let answer: Record<string, unknown> = {};
let bodies: any[] = [];
let fail = false;
const base = { summary: "用限時動態問答帶私訊", category: "marketing", tags: ["社群"], lens: "marketing", score_arx: 5, score_feasibility: 9, score_market: 6, score_reason: "r", next_step: "n" };

beforeEach(() => {
  reset();
  bodies = [];
  fail = false;
  answer = { ...base };
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (fail) return new Response("boom", { status: 500 });
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Response.json({ content: [{ type: "tool_use", id: "t", name: body.tools?.[0]?.name, input: answer }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });
  });
});

const addProjects = async () => {
  const fit = (await fakeDb.from("projects").insert({ slug: "fit", name: "Fit", description: "健身紀錄 App", slack_channel: "", sort: 0 }).select().single()).data as { id: string };
  const cafe = (await fakeDb.from("projects").insert({ slug: "cafe", name: "Cafe", description: "咖啡店訂位網站", slack_channel: "", sort: 1 }).select().single()).data as { id: string };
  return { fit: fit.id, cafe: cafe.id };
};
const addIdea = async (extra: Record<string, unknown> = {}) => ({ ...(await fakeDb.from("ideas").insert({ content: "內容", ...extra }).select().single()).data }) as Idea;

describe("評分的純函式", () => {
  it("評分角度：設計類固定是設計，其他用 AI 選的，沒選就照分類", () => {
    expect(lensFor("ui_design", "marketing")).toBe("design");
    expect(lensFor("marketing", "operations")).toBe("operations");
    expect(lensFor("startup_idea", "亂寫")).toBe("business");
    expect(lensFor("other", undefined)).toBe("insight");
  });
  it("三項分數的名稱跟著角度換；舊算法評的沿用可行／市場", () => {
    expect(axisLabels("marketing")).toMatchObject({ ease: "好執行", value: "預期成效" });
    expect(axisLabels("operations", "en").ease).toBe("Easy to adopt");
    expect(axisLabels(null)).toEqual({ ease: "可行", value: "市場", lens: null });
  });
  it("各專案分數：用名稱對專案、分數夾在 1～10、對不到的丟掉", () => {
    const ps = [{ id: "a", name: "Fit" }, { id: "b", name: "Cafe" }];
    expect(cleanProjectScores([{ project: "fit ", score: 12 }, { project: "Cafe", score: "3" }, { project: "別的", score: 9 }, null], ps)).toEqual({ a: 10, b: 3 });
    expect(cleanProjectScores("x", ps)).toEqual({});
  });
  it("最適合的專案：指定的優先，否則取最高分，同分取排前面的", () => {
    expect(bestFit({ a: 4, b: 8 })).toEqual({ id: "b", score: 8 });
    expect(bestFit({ a: 4, b: 8 }, "a")).toEqual({ id: "a", score: 4 });
    expect(bestFit({ a: 7, b: 7 }, null, ["b", "a"])).toEqual({ id: "b", score: 7 });
    expect(bestFit(null)).toBeNull();
    // 指定的專案沒被評到：不拿別的專案頂替
    expect(bestFit({ b: 8 }, "a")).toBeNull();
  });
  it("沒有版本或版本比較舊的算舊算法", () => {
    expect(isOldScoring(null)).toBe(true);
    expect(isOldScoring({ v: 1 })).toBe(true);
    expect(isOldScoring({ v: SCORING_VERSION })).toBe(false);
  });
});

describe("分析點子（新評分）", () => {
  it("每個專案都要評；適用度取分數最高的專案，不看 AI 另外給的 score_arx", async () => {
    const p = await addProjects();
    answer.project_fit = [{ project: "Fit", score: 3 }, { project: "Cafe", score: 9 }];
    const out = await analyzeIdea(await addIdea());
    expect(out.score_arx).toBe(9);
    expect(out.score_total).toBe(8.1); // 9×0.4＋9×0.3＋6×0.3
    expect(out.scoring).toEqual({ v: SCORING_VERSION, lens: "marketing", projects: { [p.fit]: 3, [p.cafe]: 9 } });
    const schema = bodies[0].tools[0].input_schema;
    expect(schema.properties.project_fit.items.properties.project.enum).toEqual(["Fit", "Cafe"]);
    expect(bodies[0].system).toContain("每個專案同等重要");
  });
  it("有指定專案：適用度看那個專案，就算別的專案分數比較高", async () => {
    const p = await addProjects();
    answer.project_fit = [{ project: "Fit", score: 4 }, { project: "Cafe", score: 9 }];
    const out = await analyzeIdea(await addIdea({ project_id: p.fit }));
    expect(out.score_arx).toBe(4);
  });
  it("沒有專案時照舊用 AI 給的分數", async () => {
    const out = await analyzeIdea(await addIdea());
    expect(out.score_arx).toBe(5);
    expect(out.scoring).toEqual({ v: SCORING_VERSION, lens: "marketing" });
    expect(bodies[0].tools[0].input_schema.properties.project_fit).toBeUndefined();
  });
  it("Telegram 的分數那一行用角度的名稱", async () => {
    const out = await analyzeIdea(await addIdea());
    expect(scoreLine(out, "Cafe")).toBe("Cafe 5／好執行 9／預期成效 6（綜合 6.5）");
    expect(scoreLine({ ...out, scoring: null })).toContain("／可行 9／市場 6");
  });
});

describe("小助手的台詞", () => {
  const d = {
    today: "2026-11-20",
    projects: [{ id: "p1", name: "Fit" }],
    events: [{ project_id: "p1", title: "開會", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "14:00" }],
    milestones: [{ project_id: "p1", title: "上線", due: "2026-11-21" }],
    monitor: [{ label: "Fit・網站", ok: false }],
  };
  it("服務掛掉排最前面，再來是下一個排程與快到的里程碑；英文介面講英文", () => {
    const zh = assistantLines(d, "12:00");
    expect(zh.map((l) => l.text)).toEqual(["Fit・網站 連不上，我盯著。", "14:00 開會，別忘了。", "Fit「上線」明天。"]);
    expect(zh[0].href).toBe("/monitor");
    expect(assistantLines(d, "12:00", "en")[1].text).toBe("14:00 開會. Don't forget.");
    expect(assistantLines({ ...d, events: [], milestones: [], monitor: [] }, "12:00")[0].anim).toBe("shrug");
  });
});

describe("舊點子重評", () => {
  it("只評分析好、還沒採用、舊算法的；分類與資料夾不動", async () => {
    await addProjects();
    tables.folders.push({ id: "f1", name: "行銷", sort: 0 }, { id: "f2", name: "其他", sort: 1 });
    const old = await addIdea({ status: "analyzed", category: "mindset", folder_id: "f2", score_total: 5 });
    const adopted = await addIdea({ status: "analyzed", adopted: true, score_total: 5 });
    const fresh = await addIdea({ status: "analyzed", scoring: { v: SCORING_VERSION }, score_total: 5 });
    const pending = await addIdea({ status: "pending" });
    answer.project_fit = [{ project: "Fit", score: 8 }, { project: "Cafe", score: 2 }];
    answer.folder = "行銷";
    expect((await rescoreStatus()).pending).toBe(1);

    const r = await rescoreBatch();
    expect(r).toEqual({ done: 1, failed: 0, left: 0 });
    const row = (id: string) => tables.ideas.find((i) => i.id === id)!;
    expect(row(old.id)).toMatchObject({ category: "mindset", folder_id: "f2", score_arx: 8 });
    expect(row(old.id).scoring.v).toBe(SCORING_VERSION);
    expect(row(adopted.id).score_total).toBe(5);
    expect(row(fresh.id).score_total).toBe(5);
    expect(row(pending.id).status).toBe("pending");
    expect(bodies).toHaveLength(1);
    expect(await rescoreStatus()).toMatchObject({ pending: 0, on: false, done: 1 });
  });
  it("評失敗的排到後面：下一批先試別的，不會被同一則卡住", async () => {
    const bad = await addIdea({ status: "analyzed", content: "會失敗", score_total: 3, created_at: "2026-11-20T00:00:00Z" });
    const good = await addIdea({ status: "analyzed", content: "正常", score_total: 3, created_at: "2026-11-19T00:00:00Z" });
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (JSON.stringify(body.messages).includes("會失敗")) return new Response("boom", { status: 500 });
      return Response.json({ content: [{ type: "tool_use", id: "t", name: body.tools?.[0]?.name, input: base }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    });
    const r = await rescoreBatch();
    expect(r).toMatchObject({ done: 1, failed: 1 });
    const row = (id: string) => tables.ideas.find((i) => i.id === id)!;
    expect(row(good.id).scoring.v).toBe(SCORING_VERSION);
    expect(row(bad.id)).toMatchObject({ status: "analyzed", score_total: 3 });
    // 剩下的只有失敗過的那則：這一輪收工，不再重試
    expect(await rescoreStatus()).toMatchObject({ pending: 1, on: false, done: 1, failed: 1 });
  });
  it("AI 失敗時把原本的狀態放回去，連續 3 則失敗就停", async () => {
    for (let n = 0; n < 5; n++) await addIdea({ status: "analyzed", score_total: 6, analyze_attempts: 1 });
    fail = true;
    const r = await rescoreBatch();
    expect(r).toEqual({ done: 0, failed: 3, left: 5 });
    expect(tables.ideas.every((i) => i.status === "analyzed" && i.score_total === 6 && i.analyze_attempts === 1)).toBe(true);
    expect(await rescoreStatus()).toMatchObject({ pending: 5, on: false, failed: 3 });
  });
});
