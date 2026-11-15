// Slack 進度回報（讀頻道 → AI 整理 → 更新專案 → Telegram 通知可改回來）＋點子指定專案
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import type { Project } from "@/lib/projectLogic";
import { planSlackUpdate, slackChannelFor, usableMessages } from "@/lib/slackLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => pending.push(fn()) };
});
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ email: "me" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";
process.env.ANTHROPIC_API_KEY = "k";
process.env.SLACK_BOT_TOKEN = "xoxb-test";

const TODAY = "2026-11-02";
const FIT_ID = "11111111-1111-1111-1111-111111111111";
const CAFE_ID = "22222222-2222-2222-2222-222222222222";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發", "封測", "上架審核"], stage: 2, next_step: "整理回報",
  status: "active", folder: "Fit", repo: null, description: "健身社群 App", slack_channel: null, sort: 10,
  last_activity_at: new Date().toISOString(), stale_asked_at: null, ...over,
});

describe("Slack 規則", () => {
  it("頻道名稱：沒設定用短名、去掉 #、不分大小寫", () => {
    expect(slackChannelFor({ slug: "fit", slack_channel: null })).toBe("progress-fit");
    expect(slackChannelFor({ slug: "fit", slack_channel: "#Fit-dev" })).toBe("fit-dev");
  });
  it("只讀一般訊息，排除自己的 Bot、系統訊息、空白，由舊到新", () => {
    const out = usableMessages(
      [
        { ts: "3", text: "新的" },
        { ts: "1", text: "舊的" },
        { ts: "2", subtype: "channel_join", text: "加入了" },
        { ts: "4", text: "我自己發的", user: "BOT" },
        { ts: "5", text: "  " },
        { ts: "6", text: "別的 App", subtype: "bot_message", bot_id: "B1" },
      ],
      "BOT",
    );
    expect(out.map((m) => m.ts)).toEqual(["1", "3", "6"]);
  });
  it("AI 結果：階段要在清單裡、日期要在今天以後、重複的里程碑不加、沒變就不改", () => {
    const p = proj();
    const plan = planSlackUpdate(
      p,
      {
        log: "修好地圖",
        next_step: "整理回報",
        stage: "不存在",
        milestones: [
          { title: "正式上架", due: "2026-12-01" },
          { title: "正式上架", due: "2026-12-01" },
          { title: "過去的", due: "2026-10-01" },
          { title: "錯的日期", due: "12/1" },
          { title: "已經有了", due: "2026-11-20" },
        ],
      },
      TODAY,
      [{ project_id: FIT_ID, title: "已經有了", due: "2026-11-20" }],
    );
    expect(plan.patch).toEqual({});
    expect(plan.milestones).toEqual([{ title: "正式上架", due: "2026-12-01" }]);
    expect(planSlackUpdate(p, { log: "", next_step: "送審", stage: "上架審核", milestones: [] }, TODAY, []).patch).toEqual({ next_step: "送審", stage: 3 });
    const ev = planSlackUpdate(
      p,
      { log: "", next_step: "", stage: "", milestones: [], events: [
        { title: "封測第二輪", start: "2026-11-20", end: "2026-11-25" },
        { title: "封測第二輪", start: "2026-11-20", end: "2026-11-25" },
        { title: "已經有", start: "2026-12-01", end: "2026-12-01" },
        { title: "太久以前", start: "2026-06-01", end: "2026-06-02" },
        { title: "結束比開始早", start: "2026-12-05", end: "2026-12-01" },
        { title: "補記上週", start: "2026-10-26", end: "2026-10-30" },
      ] },
      TODAY,
      [],
      [{ project_id: FIT_ID, title: "已經有", start_date: "2026-12-01" }],
    );
    expect(ev.events.map((e) => e.title)).toEqual(["封測第二輪", "補記上週"]);
  });
});

// ---------- 伺服器流程 ----------

let sent: Array<{ method: string; body: any }> = [];
let slackCalls: string[] = [];
let aiBodies: any[] = [];
let history: Array<{ ts: string; text: string; user?: string }> = [];
let aiInput: Record<string, unknown> = {};
let msgId = 500;
let extraChannels: Array<Record<string, unknown>> = [];

beforeEach(() => {
  reset();
  sent = [];
  slackCalls = [];
  extraChannels = [];
  aiBodies = [];
  pending.length = 0;
  history = [
    { ts: "1793590000.000100", text: "【完成】修好地圖火焰\n【下一步】送 App Store 審核\n【階段】上架審核\n【日期】12/1 正式上架", user: "U1" },
  ];
  aiInput = { log: "修好地圖火焰", next_step: "送 App Store 審核", stage: "上架審核", milestones: [{ title: "正式上架", due: "2026-12-01" }] };
  tables.projects.push(proj(), { ...proj({ id: CAFE_ID, slug: "cafe", name: "Cafe", stages: ["開發", "上線前準備"], stage: 1, description: "交友配對" }), sort: 20 });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.host === "api.telegram.org") {
      const method = u.pathname.split("/").pop()!;
      sent.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "https://x/api/telegram" } });
      return Response.json({ ok: true, result: { message_id: ++msgId } });
    }
    if (u.host === "slack.com") {
      const method = u.pathname.replace("/api/", "");
      slackCalls.push(method);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
      if (method === "auth.test") return Response.json({ ok: true, user_id: "BOT", team: "ideabox" });
      if (method === "conversations.list")
        return Response.json({ ok: true, channels: [{ id: "C1", name: "progress-fit", is_member: true }, { id: "C2", name: "progress-cafe", is_member: false }, { id: "C3", name: "fit", is_member: true }, ...extraChannels] });
      if (method === "conversations.join") return Response.json({ ok: true });
      if (method === "conversations.history") {
        const oldest = Number(u.searchParams.get("oldest"));
        const ch = u.searchParams.get("channel");
        if (ch === "C9") return Response.json({ ok: true, messages: history.filter((m) => Number(m.ts) > oldest) });
        const msgs = ch === "C1" ? history.filter((m) => Number(m.ts) > oldest) : [];
        return Response.json({ ok: true, messages: [...msgs].reverse() });
      }
      return Response.json({ ok: false, error: "unknown_method" });
    }
    if (u.host === "api.anthropic.com") {
      const body = JSON.parse(String(init?.body));
      aiBodies.push(body);
      const input =
        body.tools[0].name === "save_project_update"
          ? aiInput
          : { summary: "好友挑戰", category: "arx_feature", tags: ["社群"], score_arx: 8, score_feasibility: 7, score_market: 6, score_reason: "r", next_step: "n" };
      return Response.json({ content: [{ type: "tool_use", id: "t", name: body.tools[0].name, input }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error("unexpected fetch " + u);
  });
});

const press = async (data: string, messageId = 999) => {
  const { POST } = await import("@/app/api/telegram/route");
  const req = new Request("https://x/api/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret", "content-type": "application/json" },
    body: JSON.stringify({ callback_query: { id: "cb1", data, from: { id: 111 }, message: { message_id: messageId, chat: { id: 111 } } } }),
  });
  await POST(req as any);
  await Promise.all(pending);
  pending.length = 0;
};
const buttonsOf = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat() as Array<{ text: string; callback_data: string }>;

describe("讀 Slack 更新專案", () => {
  it("讀到回報 → 更新下一步、階段、里程碑、日誌，Telegram 通知附「改回來」；同樣的訊息不會讀第二次", async () => {
    const { runSlackSync } = await import("@/lib/slack");
    const r = await runSlackSync(Date.parse("2026-11-02T04:00:00Z"));
    expect(r).toMatchObject({ projects: 1, messages: 1, missing: [], errors: [] });
    expect(slackCalls).toContain("conversations.join"); // 公開頻道 cafe 自動加入
    expect(tables.projects[0]).toMatchObject({ next_step: "送 App Store 審核", stage: 3 });
    expect(tables.project_milestones).toHaveLength(1);
    expect(tables.project_milestones[0]).toMatchObject({ title: "正式上架", due: "2026-12-01" });
    expect(tables.project_logs.map((l) => l.text)).toContain("修好地圖火焰");
    expect(tables.project_logs.every((l) => l.source === "slack")).toBe(true);
    // AI 拿到的是 Slack 原文＋專案狀態，並帶 purpose
    expect(aiBodies[0].messages[0].content).toContain("【下一步】送 App Store 審核");
    expect(aiBodies[0].system).toContain("階段清單：構想、開發、封測、上架審核");
    const notice = sent.filter((s) => s.method === "sendMessage").at(-1)!.body;
    expect(notice.text).toContain("🔀 階段：封測 → 上架審核");
    expect(notice.text).toContain("👉 下一步：送 App Store 審核");
    const undo = buttonsOf(notice).find((b) => b.text === "↩️ 改回來")!;
    expect(undo).toBeTruthy();

    const again = await runSlackSync(Date.parse("2026-11-02T04:05:00Z"));
    expect(again).toMatchObject({ projects: 0, messages: 0 });
    expect(aiBodies).toHaveLength(1);

    // 按「改回來」：階段、下一步恢復，新增的里程碑刪掉
    await press(undo.callback_data);
    expect(tables.projects[0]).toMatchObject({ next_step: "整理回報", stage: 2 });
    expect(tables.project_milestones).toHaveLength(0);
    expect(sent.filter((s) => s.method === "sendMessage").at(-1)!.body.text).toContain("已改回原本的階段和下一步");
  });

  it("私人頻道（Bot 被邀請後清單裡沒有 is_member）也會讀；找不到的頻道會列出來", async () => {
    tables.projects.push({ ...proj({ id: "33333333-3333-3333-3333-333333333333", slug: "school", name: "school", stages: ["準備", "試用"], stage: 1 }), sort: 30 });
    tables.projects.push({ ...proj({ id: "44444444-4444-4444-4444-444444444444", slug: "notes", name: "Notes", stages: ["開發"], stage: 0 }), sort: 40 });
    extraChannels = [{ id: "C9", name: "progress-school", is_private: true }];
    const { runSlackSync } = await import("@/lib/slack");
    const r = await runSlackSync(Date.parse("2026-11-02T04:00:00Z"));
    expect(r.projects).toBe(2);
    expect(r.missing).toEqual(["progress-notes"]);
    expect(slackCalls.filter((c) => c === "conversations.join")).toHaveLength(1); // 只加入公開的 cafe
  });

  it("只有日誌、沒改到東西就不傳 Telegram", async () => {
    aiInput = { log: "整理程式", next_step: "", stage: "", milestones: [] };
    const { runSlackSync } = await import("@/lib/slack");
    await runSlackSync(Date.parse("2026-11-02T04:00:00Z"));
    expect(tables.project_logs.map((l) => l.text)).toEqual(["整理程式"]);
    expect(sent.filter((s) => s.method === "sendMessage")).toHaveLength(0);
  });

  it("沒設定 SLACK_BOT_TOKEN 就略過", async () => {
    const before = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;
    const { runSlackSync } = await import("@/lib/slack");
    expect(await runSlackSync()).toMatchObject({ skipped: true });
    expect(slackCalls).toHaveLength(0);
    process.env.SLACK_BOT_TOKEN = before;
  });
});

describe("點子指定專案", () => {
  it("Telegram 存點子附專案按鈕；按下去就針對那個專案重新分析並改寫回覆", async () => {
    const { POST } = await import("@/app/api/telegram/route");
    await POST(
      new Request("https://x/api/telegram", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": "s3cret", "content-type": "application/json" },
        body: JSON.stringify({ message: { message_id: 1, chat: { id: 111, type: "private" }, from: { id: 111 }, text: "用好友挑戰提高留存率" } }),
      }) as any,
    );
    await Promise.all(pending);
    pending.length = 0;
    // 沒指定時，AI 看得到所有專案
    expect(aiBodies[0].system).toContain("- Fit：健身社群 App");
    expect(aiBodies[0].system).toContain("- Cafe：交友配對");
    const reply = sent.filter((s) => s.method === "sendMessage").at(-1)!.body;
    expect(reply.text).toContain("相關 8");
    const btn = buttonsOf(reply).find((b) => b.text === "🏷 Cafe")!;
    expect(btn).toBeTruthy();

    await press(btn.callback_data, reply.reply_parameters ? 501 : 501);
    expect(tables.ideas[0].project_id).toBe(CAFE_ID);
    expect(aiBodies.at(-1).system).toContain("指定給「Cafe」專案");
    const edit = sent.find((s) => s.method === "editMessageText")!.body;
    expect(edit.text).toContain("Cafe 8");
    expect(buttonsOf(edit).some((b) => b.text === "✓ Cafe")).toBe(true);
  });

  it("網站：新增時選專案、詳情裡改專案都會帶進分析", async () => {
    const a = await import("@/app/(dash)/actions");
    const fd = new FormData();
    fd.set("input", "做一個好友排行榜");
    fd.set("project", FIT_ID);
    const r = await a.addIdea(null, fd);
    expect(r?.items).toHaveLength(1);
    expect(tables.ideas[0].project_id).toBe(FIT_ID);
    expect(aiBodies.at(-1).system).toContain("指定給「Fit」專案");
    expect((await a.setIdeaProject(tables.ideas[0].id, "")).ok).toBe(true);
    expect(tables.ideas[0].project_id).toBeNull();
    expect(aiBodies.at(-1).system).toContain("創業家手上的專案");
  });
});
