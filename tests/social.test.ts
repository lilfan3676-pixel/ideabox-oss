// 社群助手第 2 批：爆款靈感庫（開頭公式、倍數、話題雷達自動存）＋每週內容規劃
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import type { Project } from "@/lib/projectLogic";
import { auditForPrompt, auditOf, cleanMetrics, findings, median } from "@/lib/auditLogic";
import { dueIso, type Post } from "@/lib/postLogic";
import { PROFILE_RUBRIC, PROFILE_TOTAL, bucketCounts, cleanCommentOut, cleanProfile, cleanReplies, parseComments } from "@/lib/engageLogic";
import { classifyHook, cleanSwipe, firstSentence, formulaCounts, multipleOf, sortSwipes, swipesForPrompt, type Swipe } from "@/lib/swipeLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
let canEdit = true;
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => ({ email: "me" }),
  requireProjectEdit: async () => {
    if (!canEdit) throw new Error("沒有權限");
    return { owner: true };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
process.env.ANTHROPIC_API_KEY = "k";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想"], stage: 0, next_step: null, status: "active", folder: null, repo: null, sort: 10,
  last_activity_at: new Date().toISOString(), stale_asked_at: null, description: "每週幫你排一次運動的小工具", links: {}, ...over,
});
const swipe = (over: Partial<Swipe> = {}): Swipe => ({ id: "s", project_id: FIT_ID, account: "@a", hook: "沒人告訴你前 30 支影片本來就沒人看", url: null, views: 410000, median_views: 11000, likes: null, formula: "untold", note: "", source: "manual", created_at: "2026-11-01T00:00:00Z", ...over });

let claudeBodies: any[] = [];
let toolInput: unknown = { slots: [] };
beforeEach(() => {
  reset();
  claudeBodies = [];
  canEdit = true;
  tables.projects.push({ ...proj() });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(String(init?.body));
      claudeBodies.push(body);
      const content = body.tools ? [{ type: "tool_use", id: "t", name: body.tools[0].name, input: toolInput }] : [{ type: "text", text: "草稿" }];
      return Response.json({ content, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error("unexpected fetch " + u);
  });
});

describe("靈感庫：規則", () => {
  it("開頭公式歸類", () => {
    expect(classifyHook("沒人告訴你前 30 支影片本來就沒人看")).toBe("untold");
    expect(classifyHook("我花了三個月才發現這件事做錯了")).toBe("cost");
    expect(classifyHook("別再每天排運動了")).toBe("stop");
    expect(classifyHook("30 天從 0 做到 5000 人追蹤")).toBe("number");
    expect(classifyHook("我們故意不讓你一直滑")).toBe("contrary");
    expect(classifyHook("大學生到底都去哪裡認識人？")).toBe("question");
    expect(classifyHook("3 個方法讓你每週都去運動")).toBe("list");
    expect(classifyHook("今天天氣不錯")).toBe("other");
  });

  it("倍數：看平常的幾倍，缺數字算不出來；排序與統計只算 3 倍以上", () => {
    expect(multipleOf({ views: 412000, median_views: 10700 })).toBe(38.5);
    expect(multipleOf({ views: 400000, median_views: null })).toBeNull();
    const list = [
      swipe({ id: "big", views: 400000, median_views: 350000, formula: "list" }), // 大帳號平常的一天
      swipe({ id: "hit", views: 180000, median_views: 16000, formula: "cost" }),
      swipe({ id: "top" }),
      swipe({ id: "radar", views: null, median_views: null, likes: 320, formula: "question", source: "radar" }),
    ];
    expect(sortSwipes(list).map((s) => s.id)).toEqual(["top", "hit", "big", "radar"]);
    expect(formulaCounts(list)).toEqual(expect.arrayContaining([{ key: "untold", n: 1 }, { key: "cost", n: 1 }]));
    expect(formulaCounts(list)).toHaveLength(2);
    const prompt = swipesForPrompt(list);
    expect(prompt).toContain("沒人告訴你（平常的 37.3 倍）");
    expect(prompt).not.toContain("3 個方法"); // 1 倍多的不給 AI
  });

  it("整理輸入：41萬、18k、@、網址；第一句", () => {
    const r = cleanSwipe({ account: "@@acct", hook: "  我花了三個月才發現  ", views: "41萬", median: "1.1萬", url: "https://x.example/p/1" });
    expect(r).toEqual({ row: { account: "@acct", hook: "我花了三個月才發現", url: "https://x.example/p/1", views: 410000, median_views: 11000, formula: "cost", note: "" } });
    expect(cleanSwipe({ hook: "嗨" })).toEqual({ error: expect.stringContaining("開頭") });
    expect(cleanSwipe({ hook: "一句開頭的話", views: "很多" })).toEqual({ error: expect.stringContaining("觀看數") });
    expect(cleanSwipe({ hook: "一句開頭的話", url: "javascript:alert(1)" })).toEqual({ error: expect.stringContaining("連結") });
    expect("row" in cleanSwipe({ hook: "一句開頭的話", views: "18k" }) && (cleanSwipe({ hook: "一句開頭的話", views: "18k" }) as any).row.views).toBe(18000);
    expect(firstSentence("大學生到底都去哪裡認識人？我自己是覺得很難\n第二行")).toBe("大學生到底都去哪裡認識人？");
  });
});

describe("靈感庫：流程", () => {
  it("網頁新增、刪除；沒權限不能改", async () => {
    const a = await import("@/app/(dash)/social/actions");
    expect((await a.addSwipeAction(FIT_ID, { account: "a", hook: "沒人告訴你這件事有多難", views: "9000", median: "1000" })).ok).toBe(true);
    expect(tables.social_swipes[0]).toMatchObject({ project_id: FIT_ID, account: "@a", formula: "untold", views: 9000, median_views: 1000, source: "manual" });
    expect((await a.addSwipeAction(FIT_ID, { hook: "" })).ok).toBe(false);
    canEdit = false;
    await expect(a.deleteSwipeAction(tables.social_swipes[0].id)).rejects.toThrow("沒有權限");
    canEdit = true;
    expect((await a.deleteSwipeAction(tables.social_swipes[0].id)).ok).toBe(true);
    expect(tables.social_swipes).toHaveLength(0);
  });

  it("話題雷達：讚數最高的 5 篇自動存，同一個連結不重複", async () => {
    const { saveRadarSwipes } = await import("@/lib/swipes");
    const posts = Array.from({ length: 7 }, (_, i) => ({ url: `https://t.example/${i}`, author: `u${i}`, text: `大學生到底都去哪裡認識人？第 ${i} 篇`, likes: i * 10, replies: 0, at: null, keyword: "認識人" }));
    expect(await saveRadarSwipes(FIT_ID, posts)).toBe(5);
    expect(tables.social_swipes.map((s) => s.likes)).toEqual([60, 50, 40, 30, 20]);
    expect(tables.social_swipes[0]).toMatchObject({ account: "@u6", hook: "大學生到底都去哪裡認識人？", formula: "question", source: "radar", views: null });
    expect(await saveRadarSwipes(FIT_ID, posts)).toBe(0);
  });
});

describe("每週內容規劃", () => {
  const WEEK = "2026-11-23";
  const DATES = ["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  const slot = (over: Record<string, unknown> = {}) => ({ date: "2026-11-26", time: "20:00", platform: "ig", format: "reel", kind: "proof", topic: "開站第一天 40 人加好友", source: "這週發生的事", formula: "number", ...over });

  it("檢查 AI 的計畫：日期、格式、類型、最多 5 則、照時間排", async () => {
    const { cleanPlan } = await import("@/lib/socialPlan");
    const out = cleanPlan({ slots: [
      slot({ date: "2026-11-28", time: "19:30" }),
      slot({ date: "2026-11-24" }), // 已經過了，不在可排的日期
      slot({ platform: "fb_group", format: "reel", kind: "亂寫", formula: "沒有這種", time: "晚上" }),
      slot({ topic: "  " }),
      ...Array.from({ length: 5 }, () => slot({ date: "2026-11-29" })),
    ] }, DATES);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ date: "2026-11-26", platform: "fb_group", format: "post", kind: "teach", formula: "other", time: "20:00" });
    expect(out[1]).toMatchObject({ date: "2026-11-28", time: "19:30", format: "reel", kind: "proof" });
    expect(cleanPlan({}, DATES)).toEqual([]);
  });

  it("AI 排這週：帶這週發生的事、日誌、雷達痛點、靈感庫、最近發過的；系統日誌不給", async () => {
    const { planWeek } = await import("@/lib/socialPlan");
    const now = new Date().toISOString();
    tables.project_logs.push({ id: 1, project_id: FIT_ID, at: now, source: "manual", text: "開站，第一天 40 人加好友" }, { id: 2, project_id: FIT_ID, at: now, source: "system", text: "話題雷達：看了 30 篇" });
    tables.radar_reports.push({ id: "r", project_id: FIT_ID, status: "done", created_at: now, summary: { overview: "", themes: [], pains: [{ title: "怕被同學看到", detail: "很多人擔心隱私", urls: [], score: 5 }] } });
    tables.social_swipes.push({ ...swipe() });
    tables.project_posts.push({ id: "p", project_id: FIT_ID, platform: "ig", format: "reel", kind: "teach", due_at: now, topic: "上週講過的主題", body: "", status: "posted", target: "" });
    toolInput = { slots: [slot(), slot({ date: "2026-11-27", format: "carousel", kind: "teach", topic: "會不會被同學看到？三個設定一次講完", source: "話題雷達痛點", formula: "question" })] };
    const r = await planWeek(proj(), WEEK, "2026-11-25", "這週有人問會不會被同學看到");
    expect(r.slots).toHaveLength(2);
    expect(r.slots![1]).toMatchObject({ format: "carousel", kind: "teach", formula: "question" });
    const b = claudeBodies[0];
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.system).toContain("不能連續兩則同一種");
    const user = b.messages[0].content as string;
    expect(user).toContain("2026-11-25（週三）");
    expect(user).not.toContain("2026-11-24");
    expect(user).toContain("這週有人問會不會被同學看到");
    expect(user).toContain("第一天 40 人加好友");
    expect(user).not.toContain("看了 30 篇");
    expect(user).toContain("怕被同學看到");
    expect(user).toContain("沒人告訴你（平常的 37.3 倍）");
    expect(user).toContain("上週講過的主題");
    expect(user).toContain("ig（IG，1 則）");
    expect(tables.ai_usage[0].purpose).toBe("social_plan");
    expect((await planWeek(proj(), "2026-11-09", "2026-11-25", "")).error).toContain("已經過了");
  });

  it("存成草稿：只有主題、帶格式與類型；過去的日期不存；寫草稿時帶類型與靈感庫", async () => {
    const a = await import("@/app/(dash)/social/actions");
    const { taipeiDate } = await import("@/lib/dates");
    const { addDays } = await import("@/lib/postLogic");
    const next = addDays(taipeiDate(), 2);
    const r = await a.savePlanAction(FIT_ID, [slot({ date: next }), slot({ date: "2020-01-01" })] as never);
    expect(r).toMatchObject({ ok: true, saved: 1 });
    expect(tables.project_posts[0]).toMatchObject({ project_id: FIT_ID, platform: "ig", format: "reel", kind: "proof", topic: "開站第一天 40 人加好友", body: "", status: "draft" });
    canEdit = false;
    await expect(a.planWeekAction(FIT_ID, WEEK, "")).rejects.toThrow("沒有權限");
    canEdit = true;

    tables.social_swipes.push({ ...swipe() });
    expect((await a.draftPostAction(FIT_ID, { platform: "ig", format: "reel", kind: "proof", target: "", topic: "開站第一天" })).draft).toBe("草稿");
    const user = claudeBodies.at(-1).messages[0].content as string;
    expect(user).toContain("這篇的類型：成果證明");
    expect(user).toContain("同領域最近有效的開頭");
  });
});

describe("成效檢討", () => {
  let seq = 0;
  const posted = (views: number | null, over: Partial<Post> = {}, m: Record<string, number> = {}): Post => ({
    id: `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`, project_id: FIT_ID, platform: "ig", format: "reel", kind: "proof", target: "", due_at: dueIso("2026-11-10", "20:00")!, topic: `第 ${seq} 則`, body: "",
    image_path: null, status: "posted", notified_at: null, posted_at: null, source: "manual", created_at: "", updated_at: "", metrics: views === null ? null : { views, reach: views, ...m }, ...over,
  });

  it("整理數字：2.6萬、18k、百分比；空的不存", () => {
    expect(cleanMetrics({ views: "2.6萬", reach: "18k", shares: "71", follows: "", nonfollower: "62%", likes: "很多", comments: 3 })).toEqual({ views: 26000, reach: 18000, shares: 71, nonfollower: 62, comments: 3 });
    expect(cleanMetrics({ nonfollower: "250" })).toEqual({});
    expect(cleanMetrics(null)).toEqual({});
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 2])).toBe(3);
    expect(median([])).toBeNull();
  });

  it("倍數看自己的中位數；每千觸及的分享與追蹤；沒填的列在待填", () => {
    const posts = [posted(26300, {}, { shares: 71, follows: 12 }), posted(4100, {}, { shares: 4 }), posted(1200, { format: "carousel", kind: "teach" }, { shares: 2, follows: 0 }), posted(null, { topic: "還沒填" }), posted(9000, { status: "scheduled" })];
    const a = auditOf(posts);
    expect(a.medianViews).toBe(4100);
    expect(a.rows.map((r) => r.multiple)).toEqual([6.4, 1, 0.3]);
    expect(a.rows[0]).toMatchObject({ sharesPerK: 2.7, followsPerK: 0.5, format: "reel", kind: "proof" });
    expect(a.missing.map((m) => m.title)).toEqual(["還沒填"]);
    expect(a.sharesPerK).toBe(2.4); // (71+4+2) / 31600 * 1000
    expect(findings(a)).toEqual([]); // 少於 6 則不下結論
    expect(auditForPrompt(a)).toContain("6.4 倍｜Reel／成果證明");
    expect(auditForPrompt(auditOf(posts.slice(0, 2)))).toBe("");
  });

  it("樣本夠了才講：哪種格式有效、哪類分享率高、觀看高卻沒追蹤", () => {
    const posts = [
      posted(12000, {}, { shares: 130, follows: 0 }), posted(9000, {}, { shares: 90, follows: 9 }), posted(8000, {}, { shares: 80, follows: 8 }),
      posted(3000, { format: "carousel", kind: "teach" }, { shares: 3, follows: 3 }), posted(2000, { format: "carousel", kind: "teach" }, { shares: 2, follows: 2 }), posted(1000, { format: "carousel", kind: "teach" }, { shares: 1, follows: 1 }),
    ];
    const f = findings(auditOf(posts));
    const keys = f.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["format", "kind-share", "profile"]));
    expect(f.find((x) => x.key === "format")!.text[0]).toContain("Reel的中位數是你平常的 1.6 倍，輪播 0.4 倍（各 3 則、3 則）");
    expect(f.find((x) => x.key === "kind-share")!.text[0]).toContain("成果證明");
  });

  it("存數字、清掉；截圖讀數字（不存檔）；AI 解讀；排這週會帶成效", async () => {
    const a = await import("@/app/(dash)/social/actions");
    const p = posted(null);
    tables.project_posts.push({ ...p });
    expect((await a.saveMetricsAction(p.id, { views: "2.6萬", shares: "71" })).ok).toBe(true);
    expect(tables.project_posts[0].metrics).toEqual({ views: 26000, shares: 71 });
    expect(tables.project_posts[0].metrics_at).not.toBeNull();
    expect((await a.saveMetricsAction(p.id, {})).ok).toBe(true);
    expect(tables.project_posts[0].metrics).toBeNull();

    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]).toString("base64")}`;
    toolInput = { views: 26300, reach: 18000, likes: null, comments: null, shares: 71, saves: null, follows: 12, nonfollower: 62 };
    const r = await a.readMetricsAction(FIT_ID, png);
    expect(r.metrics).toEqual({ views: 26300, reach: 18000, shares: 71, follows: 12, nonfollower: 62 });
    expect(claudeBodies.at(-1).model).toBe("claude-haiku-5-5");
    expect(claudeBodies.at(-1).messages[0].content[0].type).toBe("image");
    expect(tables.ai_usage.at(-1)!.purpose).toBe("social_metrics");
    expect((await a.readMetricsAction(FIT_ID, "data:image/png;base64,AAAA")).error).toContain("只接受");
    toolInput = { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, follows: null, nonfollower: null };
    expect((await a.readMetricsAction(FIT_ID, png)).error).toContain("沒讀到數字");

    expect((await a.auditAdviceAction(FIT_ID)).error).toContain("不到 3 則");
    tables.project_posts.length = 0;
    tables.project_posts.push(...[26300, 4100, 1200].map((v) => ({ ...posted(v) })));
    expect((await a.auditAdviceAction(FIT_ID)).draft).toBe("草稿");
    expect(claudeBodies.at(-1).messages[0].content).toContain("表現最好的");
    expect(tables.ai_usage.at(-1)!.purpose).toBe("social_audit");

    const { planWeek } = await import("@/lib/socialPlan");
    toolInput = { slots: [] };
    await planWeek(proj(), "2026-11-23", "2026-11-25", "隨便寫一句");
    expect(claudeBodies.at(-1).messages[0].content).toContain("我自己貼文的成效");
    canEdit = false;
    await expect(a.saveMetricsAction(tables.project_posts[0].id, { views: "1" })).rejects.toThrow("沒有權限");
  });
});

describe("互動與檔案健檢：規則", () => {
  it("拆留言：一行一則、認得帳號、最多 60 則", () => {
    const c = parseComments("@a：週三\nb_2: 我們系上也有人問\n\n沒有帳號的一句話\n網址 https://x.example/a:b 也不會被當成帳號");
    expect(c.map((x) => [x.n, x.who, x.text])).toEqual([[1, "@a", "週三"], [2, "@b_2", "我們系上也有人問"], [3, "", "沒有帳號的一句話"], [4, "", "網址 https://x.example/a:b 也不會被當成帳號"]]);
    expect(parseComments(Array.from({ length: 80 }, (_, i) => `u${i}：嗨`).join("\n"))).toHaveLength(60);
  });

  it("檢查分類與回覆：對編號、不用回的清掉回覆、只有好問題能標 Reel、照類別排", () => {
    const comments = parseComments("@a：週三\n@b：互追嗎\n@c：會不會被同學看到？\n@d：🔥");
    const out = cleanReplies({ replies: [
      { n: 2, bucket: "noise", reply: "不要回這個", reel: true },
      { n: 3, bucket: "question", reply: "不會，只有配到的人看得到。", reel: true },
      { n: 1, bucket: "keyword", reply: "@a 傳給你了", reel: true },
      { n: 9, bucket: "lead", reply: "沒有這一則", reel: false },
    ] }, comments);
    expect(out.map((r) => [r.n, r.bucket, r.reel])).toEqual([[1, "keyword", false], [3, "question", true], [4, "support", false], [2, "noise", false]]);
    expect(out.find((r) => r.n === 2)!.reply).toBe("");
    expect(bucketCounts(out)).toMatchObject({ keyword: 1, question: 1, support: 1, noise: 1, lead: 0 });
    expect(cleanCommentOut({ options: [{ type: "ask", text: " 一 " }, { type: "x", text: "" }, { type: "extend", text: "二" }, { type: "ask", text: "三" }], pick: "選第一則" })).toEqual({ options: [{ type: "ask", text: "一" }, { type: "extend", text: "二" }], pick: "選第一則" });
  });

  it("檔案健檢：12 項共 100 分、分數不能超過滿分、沒評到算 0、照扣最多分排", () => {
    expect(PROFILE_RUBRIC).toHaveLength(12);
    expect(PROFILE_TOTAL).toBe(100);
    const r = cleanProfile({ items: [{ id: "name_field", score: 99, note: "很好", fix: "不用改" }, { id: "bio_first_line", score: 3, note: "三個名詞", fix: "給想養成運動習慣的大學生" }, { id: "photo", score: -4, note: "", fix: "換一張" }] }, { name: "Fit" }, "2026-11-20T00:00:00Z");
    expect(r.total).toBe(15);
    expect(r.items[0].id).toBe("pinned_three"); // 10 分全扣，扣最多的之一排最前面（同分時滿分高的在前）
    expect(r.items.find((i) => i.id === "name_field")).toMatchObject({ score: 12, fix: "" });
    expect(r.items.find((i) => i.id === "photo")!.score).toBe(0);
    expect(r.items.at(-1)!.id).toBe("name_field");
  });
});

describe("互動與檔案健檢：流程", () => {
  it("回覆留言、私訊（沒有理由不寫）、去別人貼文留言；沒權限不能用", async () => {
    const a = await import("@/app/(dash)/social/actions");
    toolInput = { replies: [{ n: 1, bucket: "keyword", reply: "**傳給你了**", reel: false }, { n: 2, bucket: "question", reply: "不會\u200B。", reel: true }] };
    const r = await a.draftRepliesAction(FIT_ID, "@a：週三\n@c：會不會被同學看到？", "為什麼一週只排一次");
    expect(r.replies!.map((x) => x.reply)).toEqual(["傳給你了", "不會。"]);
    expect(claudeBodies.at(-1).system).toContain("noise 一律不寫回覆");
    expect(claudeBodies.at(-1).messages[0].content).toContain("1. @a：週三");
    expect(tables.ai_usage.at(-1)!.purpose).toBe("social_reply");
    expect((await a.draftRepliesAction(FIT_ID, "  ", "")).error).toContain("先把留言貼進來");

    const before = claudeBodies.length;
    expect((await a.draftDmAction(FIT_ID, { kind: "warm", who: "@x", trigger: "", want: "", give: "" })).error).toContain("今天為什麼傳給他");
    expect(claudeBodies.length).toBe(before); // 沒有理由就不問 AI
    toolInput = { message: "x，這是你要的排程表。", follow4: "補一個範例", follow10: "這是最後一則" };
    const dm = await a.draftDmAction(FIT_ID, { kind: "deliver", who: "@x", trigger: "他在貼文下面留了「排」", want: "", give: "排程表" });
    expect(dm.dm).toEqual({ message: "x，這是你要的排程表。", follow4: "補一個範例", follow10: "這是最後一則" });
    expect(claudeBodies.at(-1).system).toContain("第一行叫他的名字並直接把答應的東西給他");

    toolInput = { options: [{ type: "ask", text: "那第二週怎麼辦？" }, { type: "extend", text: "「一次就好」這句我會記很久。" }], pick: "選第一則" };
    const c = await a.draftCommentsAction(FIT_ID, { account: "@y", post: "一週排一次運動就夠了，重點是真的去。", mine: "" });
    expect(c.comment!.options).toHaveLength(2);
    expect(claudeBodies.at(-1).messages[0].content).toContain("不要選「我做過」");
    expect((await a.draftCommentsAction(FIT_ID, { account: "", post: "短", mine: "" })).error).toContain("先把對方貼文");

    canEdit = false;
    await expect(a.draftRepliesAction(FIT_ID, "@a：嗨", "")).rejects.toThrow("沒有權限");
  });

  it("檔案健檢：評分存在專案底下，下次讀得到；資料不夠不問 AI", async () => {
    const a = await import("@/app/(dash)/social/actions");
    const { lastProfile } = await import("@/lib/engage");
    expect((await a.checkProfileAction(FIT_ID, { name: "Fit" })).error).toContain("至少填名稱欄和簡介");
    expect(claudeBodies).toHaveLength(0);
    toolInput = { items: [{ id: "name_field", score: 2, note: "只有名字", fix: "Fit｜每週排一次運動／Fit 運動排程" }, { id: "bio_first_line", score: 3, note: "三個名詞", fix: "給想養成運動習慣的大學生" }] };
    const r = await a.checkProfileAction(FIT_ID, { name: "Fit", bio: "運動｜生活｜咖啡" });
    expect(r.profile!.total).toBe(5);
    expect(claudeBodies.at(-1).system).toContain("name_field（名稱欄，12 分）");
    expect(tables.ai_usage.at(-1)!.purpose).toBe("social_profile");
    const saved = await lastProfile(FIT_ID);
    expect(saved).toMatchObject({ total: 5, input: { name: "Fit", bio: "運動｜生活｜咖啡" } });
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]).toString("base64")}`;
    expect((await a.checkProfileAction(FIT_ID, {}, png)).ok).toBe(true); // 只有截圖也可以
    expect(claudeBodies.at(-1).messages[0].content[0].type).toBe("image");
  });
});
