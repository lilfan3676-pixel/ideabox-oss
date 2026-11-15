// 話題雷達（Apify 抓 Threads → AI 整理主題與痛點 → 存週報、高分痛點存成點子、Telegram 通知）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import type { Project } from "@/lib/projectLogic";
import { cleanKeywords, cleanSummary, effectiveStatus, painIdeaText, painsToSave, radarTelegram, toPosts, type RadarPost } from "@/lib/radarLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";
process.env.ANTHROPIC_API_KEY = "k";
process.env.APP_URL = "https://ideabox.test";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發"], stage: 1, next_step: null, status: "active", folder: null, repo: null,
  description: "健身社群 App", sort: 10, last_activity_at: new Date().toISOString(), stale_asked_at: null, radar_keywords: ["健身菜單"], ...over,
});
const row = (code: string, text: string, likes = 0, replies = 0) => ({
  record_type: "post", post_code: code, post_url: `https://www.threads.com/@u/post/${code}`, username: "u", text_content: text, like_count: likes, reply_count: replies, created_at: "2026-11-07T00:00:00Z",
});

describe("話題雷達規則", () => {
  it("關鍵字：頓號逗號換行都能分、去掉 #、不分大小寫去重、最多 5 個", () => {
    expect(cleanKeywords("#健身菜單、重訓 卡關, AI，ai\n a,b,c,d")).toEqual(["健身菜單", "重訓 卡關", "AI", "a", "b"]);
    expect(cleanKeywords("  ")).toEqual([]);
  });

  it("貼文：只留 Threads 貼文、太短與重複的丟掉、留言權重比讚高", () => {
    const posts = toPosts([
      row("A", "這是一篇很普通的分享文，內容夠長", 10, 0),
      row("B", "想找一個可以排重訓菜單的 App 都找不到", 2, 5),
      row("A", "這是一篇很普通的分享文，內容夠長", 10, 0),
      row("C", "太短", 99, 99),
      { record_type: "profile", username: "x" },
      { ...row("D", "網址不是 Threads 的貼文內容夠長喔"), post_url: "https://evil.example/x" },
      null,
    ]);
    expect(posts.map((p) => p.url.slice(-1))).toEqual(["B", "A"]);
  });

  it("AI 結果：編號換成真網址、不存在的編號丟掉、分數夾在 1～5", () => {
    const posts = toPosts([row("A", "第一篇內容內容內容內容內容"), row("B", "第二篇內容內容內容內容內容")]) as RadarPost[];
    const s = cleanSummary(
      { overview: "大家在聊菜單", themes: [{ title: "菜單", detail: "d", refs: [1, 99] }, { title: "", refs: [1] }], pains: [{ title: "排菜單很麻煩", detail: "d", refs: [2, 2], score: 9 }, { title: "低分", refs: [1], score: 0 }] },
      posts,
    );
    expect(s.themes).toEqual([{ title: "菜單", detail: "d", urls: [posts[0].url] }]);
    expect(s.pains[0]).toEqual({ title: "排菜單很麻煩", detail: "d", urls: [posts[1].url], score: 5 });
    expect(s.pains[1].score).toBe(3); // 0 視為沒給，用預設 3
    expect(cleanSummary({} as never, posts)).toEqual({ overview: "", themes: [], pains: [] });
  });

  it("要存的痛點：4 分以上、有原文、最多 3 個、高分先", () => {
    const p = (title: string, score: number, urls = ["u"]) => ({ title, detail: "", urls, score });
    expect(painsToSave([p("a", 4), p("b", 5), p("c", 3), p("d", 5, []), p("e", 4), p("f", 4)]).map((x) => x.title)).toEqual(["b", "a", "e"]);
  });

  it("點子內文帶關鍵字與原文連結；抓取中超過 15 分鐘算失敗；Telegram 訊息有跳脫", () => {
    expect(painIdeaText({ title: "排菜單麻煩", detail: "", urls: ["https://t/1"], score: 5 }, ["健身"])).toBe("【話題雷達｜健身】排菜單麻煩\n\nThreads 原文：\nhttps://t/1");
    const now = Date.parse("2026-11-08T00:20:00Z");
    expect(effectiveStatus({ status: "running", created_at: "2026-11-08T00:00:00Z" }, now)).toBe("failed");
    expect(effectiveStatus({ status: "running", created_at: "2026-11-08T00:10:00Z" }, now)).toBe("running");
    const msg = radarTelegram("A<B", "fit", { overview: "x", themes: [], pains: [{ title: "<痛>", detail: "", urls: [], score: 5 }] }, 12, 1, "https://ideabox.test/");
    expect(msg).toContain("A&lt;B");
    expect(msg).toContain("&lt;痛&gt;");
    expect(msg).toContain("https://ideabox.test/projects/fit");
  });
});

describe("話題雷達流程", () => {
  let sent: string[];
  let apifyInput: Record<string, unknown> | null;
  let apifyRunStatus: string;
  let items: unknown[];
  let pains: { title: string; detail: string; refs: number[]; score: number }[];

  beforeEach(() => {
    reset();
    sent = [];
    apifyInput = null;
    apifyRunStatus = "SUCCEEDED";
    items = [row("A", "想找可以自動排重訓菜單的工具都找不到", 30, 12), row("B", "健身房人好多每次都要等器材", 5, 2)];
    pains = [{ title: "找不到自動排菜單的工具", detail: "很多人手動排", refs: [1], score: 5 }, { title: "器材要排隊", detail: "", refs: [2], score: 2 }];
    process.env.APIFY_TOKEN = "apify-test";
    tables.projects.push(proj());
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host === "api.telegram.org") {
        sent.push(JSON.parse(String(init?.body ?? "{}")).text ?? "");
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      if (u.host === "api.apify.com") {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer apify-test");
        if (u.pathname.endsWith("/runs")) {
          expect(u.searchParams.get("maxTotalChargeUsd")).toBe("1");
          apifyInput = JSON.parse(String(init?.body));
          return Response.json({ data: { id: "run1", status: apifyRunStatus, defaultDatasetId: "ds1" } });
        }
        if (u.pathname.includes("/datasets/ds1/items")) return Response.json(items);
        return Response.json({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" } });
      }
      if (u.host === "api.anthropic.com") {
        const body = JSON.parse(String(init?.body));
        const tool = body.tools[0].name;
        const input = tool === "radar_report"
          ? { overview: "大家在找排菜單工具", themes: [{ title: "菜單", detail: "d", refs: [1, 2] }], pains }
          : { summary: "自動排菜單", category: "product", tags: [], score_arx: 5, score_feasibility: 4, score_market: 4, score_reason: "r", next_step: "n" };
        return Response.json({ content: [{ type: "tool_use", id: "t", name: tool, input }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
      }
      return new Response("not found", { status: 404 });
    });
  });

  it("抓 → 整理 → 存週報、只把高分痛點存成這個專案的點子、傳 Telegram", async () => {
    const { runWeeklyRadar } = await import("@/lib/radar");
    expect(await runWeeklyRadar()).toBe(1);
    expect(apifyInput).toMatchObject({ mode: "search", keywords: ["健身菜單"], search_language: "chinese", start_date: "7 days" });
    const r = tables.radar_reports[0];
    expect(r.status).toBe("done");
    expect(r.post_count).toBe(2);
    expect(r.summary.pains[0].urls).toEqual(["https://www.threads.com/@u/post/A"]);
    expect(r.idea_ids).toHaveLength(1);
    const idea = tables.ideas.find((i) => i.id === r.idea_ids[0])!;
    expect(idea.project_id).toBe(FIT_ID);
    expect(idea.content).toContain("找不到自動排菜單的工具");
    expect(sent.some((t) => t.includes("Fit 話題雷達") && t.includes("挑了 1 個"))).toBe(true);
    expect(tables.project_logs.some((l) => String(l.text).startsWith("話題雷達"))).toBe(true);
  });

  it("下一週：上週的痛點告訴 AI 不要重複", async () => {
    const { runWeeklyRadar } = await import("@/lib/radar");
    await runWeeklyRadar();
    let prompt = "";
    const orig = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("anthropic") && JSON.parse(String(init?.body)).tools[0].name === "radar_report") prompt = JSON.parse(String(init?.body)).messages[0].content;
      return orig(url, init);
    });
    await runWeeklyRadar();
    expect(prompt).toContain("上週已經整理過的痛點");
    expect(prompt).toContain("找不到自動排菜單的工具");
  });

  it("沒有 token、沒關鍵字、暫停的專案都不抓；沒抓到貼文也算完成並提示換關鍵字", async () => {
    const { runWeeklyRadar } = await import("@/lib/radar");
    process.env.APIFY_TOKEN = "";
    expect(await runWeeklyRadar()).toBe(0);
    process.env.APIFY_TOKEN = "apify-test";
    tables.projects[0].status = "paused";
    expect(await runWeeklyRadar()).toBe(0);
    tables.projects[0].status = "active";
    tables.projects[0].radar_keywords = [];
    expect(await runWeeklyRadar()).toBe(0);
    expect(apifyInput).toBeNull();
    tables.projects[0].radar_keywords = ["冷門"];
    items = [];
    expect(await runWeeklyRadar()).toBe(1);
    expect(tables.radar_reports[0].summary.overview).toContain("換個關鍵字");
    expect(tables.ideas).toHaveLength(0);
  });

  it("Apify 失敗：週報標成失敗並記下原因，不存點子", async () => {
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("apify") ? new Response("quota", { status: 402 }) : Response.json({ ok: true, result: {} })));
    const { runWeeklyRadar } = await import("@/lib/radar");
    expect(await runWeeklyRadar()).toBe(0);
    expect(tables.radar_reports[0].status).toBe("failed");
    expect(tables.radar_reports[0].error).toContain("Apify 402");
    expect(tables.ideas).toHaveLength(0);
  });

  it("「抓取中」超過 15 分鐘的舊紀錄，下次執行時標成失敗", async () => {
    tables.radar_reports.push({ id: "old", project_id: FIT_ID, status: "running", created_at: new Date(Date.now() - 20 * 60_000).toISOString(), keywords: [], idea_ids: [] });
    const { runWeeklyRadar } = await import("@/lib/radar");
    await runWeeklyRadar();
    expect(tables.radar_reports.find((r) => r.id === "old")!.status).toBe("failed");
  });
});
