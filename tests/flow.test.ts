// 端到端流程測試：模擬 Telegram、Claude API、Threads 頁面與資料庫
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, stored, tables } from "./support/fakeDb";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => pending.push(fn()) };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";
process.env.ANTHROPIC_API_KEY = "k";
process.env.CRON_SECRET = "cron";

type Sent = { method: string; body: any };
let sent: Sent[] = [];
let msgId = 1000;
let threadsHtml: string | null = null;
let claudeCalls = 0;
let claudeFail = false;
let claudeOverride: Record<string, unknown> = {};
let claudeBodies: any[] = [];
// 最小的 PNG 檔頭（足以通過格式偵測）
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    content: [{
      type: "tool_use", id: "t", name: "save_analysis",
      input: { summary: "好友挑戰排行榜", category: "arx_feature", tags: ["社群"], score_arx: 9, score_feasibility: 7, score_market: 6, score_reason: "直接可用", next_step: "做好友挑戰原型", ...overrides },
    }],
    stop_reason: "tool_use",
  };
}

beforeEach(() => {
  reset();
  sent = [];
  pending.length = 0;
  claudeCalls = 0;
  claudeFail = false;
  claudeOverride = {};
  claudeBodies = [];
  for (const k of Object.keys(stored)) delete stored[k];
  threadsHtml = `<meta property="og:title" content="Amy (@amy.fit) on Threads"><meta property="og:description" content="用好友挑戰讓人連續 30 天運動">`;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/file/")) return new Response(PNG);
    if (u.endsWith("/getFile")) return Response.json({ ok: true, result: { file_path: "photos/f.png", file_size: 100 } });
    if (u.includes("instagram.com")) return new Response("", { status: 403 });
    if (u.startsWith("https://api.telegram.org/")) {
      const method = u.split("/").pop()!;
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      sent.push({ method, body });
      return Response.json({ ok: true, result: { message_id: ++msgId } });
    }
    if (u.startsWith("https://api.anthropic.com/")) {
      claudeCalls++;
      claudeBodies.push(JSON.parse(String(init?.body)));
      if (claudeFail) return new Response("overloaded", { status: 529 });
      return Response.json(analysis(claudeOverride));
    }
    if (u === "https://api.github.com/repos/shadcn-ui/ui") {
      return Response.json({ full_name: "shadcn-ui/ui", description: "Beautifully designed components", stargazers_count: 98000, language: "TypeScript", license: { spdx_id: "MIT" }, pushed_at: "2026-10-29T00:00:00Z", topics: ["react", "ui"] });
    }
    if (u === "https://api.github.com/repos/shadcn-ui/ui/readme") return new Response("# shadcn/ui\nCopy and paste components.");
    if (u.startsWith("https://opengraph.githubassets.com/") || u.startsWith("https://cdn.example/")) return new Response(PNG);
    if (u.includes("threads.com")) {
      return threadsHtml ? new Response(threadsHtml, { status: 200 }) : new Response("", { status: 403 });
    }
    throw new Error("unexpected fetch " + u);
  });
});

async function post(message: Record<string, unknown>, secret = "s3cret") {
  const { POST } = await import("@/app/api/telegram/route");
  const req = new Request("https://x/api/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "application/json" },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: 111, type: "private" }, from: { id: 111 }, ...message } }),
  });
  const before = sent.length;
  const res = await POST(req as any);
  await Promise.all(pending);
  pending.length = 0;
  // 有其他存放地點（模組）時，讀不到內容的連結會先問要存哪裡：這裡的流程都是存點子庫，自動按「點子庫」
  const ask = sent.slice(before).find((x) => x.method === "sendMessage" && String(x.body.text).includes("要存到哪裡"));
  const pick = ask?.body.reply_markup?.inline_keyboard.flat().find((b: { callback_data: string }) => b.callback_data.endsWith(":i"));
  if (pick) {
    sent = sent.filter((x) => x !== ask);
    const n = sent.length;
    const cb = { callback_query: { id: "cb", data: pick.callback_data, from: { id: 111 }, message: { message_id: 999, chat: { id: 111 } } } };
    await POST(new Request("https://x/api/telegram", { method: "POST", headers: { "x-telegram-bot-api-secret-token": secret, "content-type": "application/json" }, body: JSON.stringify(cb) }) as any);
    await Promise.all(pending);
    pending.length = 0;
    sent = [...sent.slice(0, n), ...sent.slice(n).filter((x) => x.method !== "answerCallbackQuery" && x.method !== "editMessageReplyMarkup")];
  }
  return res;
}
const replies = () => sent.filter((s) => s.method === "sendMessage").map((s) => s.body.text as string);

describe("Telegram Bot 流程", () => {
  it("錯誤的 secret 直接拒絕", async () => {
    const res = await post({ text: "hi" }, "wrong");
    expect(res.status).toBe(401);
    expect(tables.ideas).toHaveLength(0);
  });

  it("不是主人傳的訊息一律忽略", async () => {
    await post({ text: "https://www.threads.com/@a/post/X1", from: { id: 999 } });
    expect(tables.ideas).toHaveLength(0);
    expect(replies()).toHaveLength(0);
  });

  it("分享 Threads 連結 → 讀到內容 → 分析 → 回覆並記下訊息 id", async () => {
    await post({ text: "這個好 https://www.threads.net/@amy.fit/post/ABC?xmt=1" });
    expect(tables.ideas).toHaveLength(1);
    const idea = tables.ideas[0];
    expect(idea.content).toBe("用好友挑戰讓人連續 30 天運動");
    expect(idea.author).toBe("@amy.fit");
    expect(idea.note).toBe("這個好");
    expect(idea.status).toBe("analyzed");
    expect(idea.score_total).toBe(7.5);
    expect(idea.telegram_message_id).toBe(msgId);
    expect(replies().at(-1)).toContain("專案功能靈感");
  });

  it("同一則貼文再分享一次不會重複建立", async () => {
    await post({ text: "https://www.threads.com/@amy.fit/post/ABC" });
    await post({ text: "https://threads.net/@amy.fit/post/ABC/?slof=1" });
    expect(tables.ideas).toHaveLength(1);
    expect(replies().at(-1)).toContain("之前存過了");
  });

  it("讀不到內容 → 標記待補充、不呼叫 AI；回覆提示訊息後補充並分析", async () => {
    threadsHtml = null;
    await post({ text: "https://www.threads.com/@b/post/ZZZ" });
    const idea = tables.ideas[0];
    expect(idea.status).toBe("needs_input");
    expect(claudeCalls).toBe(0);
    expect(replies().at(-1)).toContain("回覆這則訊息");

    await post({ message_id: 2, text: "重點：社群打卡排行榜", reply_to_message: { message_id: idea.telegram_message_id } });
    expect(tables.ideas).toHaveLength(1);
    expect(tables.ideas[0].note).toBe("重點：社群打卡排行榜");
    expect(tables.ideas[0].status).toBe("analyzed");
  });

  it("一次多個連結各自存一筆，文字不套用", async () => {
    await post({ text: "看 https://www.threads.com/@a/post/A1 和 https://www.threads.com/@a/post/A2" });
    expect(tables.ideas).toHaveLength(2);
    expect(tables.ideas.every((i) => i.note === null)).toBe(true);
  });

  it("純文字想法也會存", async () => {
    await post({ text: "做一個健身房地圖" });
    expect(tables.ideas[0].source).toBe("text");
    expect(tables.ideas[0].status).toBe("analyzed");
  });

  it("AI 漏出來的標記、照抄欄位說明、「[]」都會清掉", async () => {
    claudeOverride = { summary: "書審攻略整理成 16 張圖。</summary> <parameter name=\"category\">other", next_step: "無", tags: ["申請", "[]"] };
    await post({ text: "青年百億書審攻略" });
    const i = tables.ideas[0];
    expect(i.summary).toBe("書審攻略整理成 16 張圖。");
    expect(i.next_step).toBeNull();
    expect(i.tags).toEqual(["申請"]);
  });

  it("中文模式下 AI 寫成英文 → 重問一次", async () => {
    claudeOverride = { summary: "An open-source AI agent app" };
    await post({ text: "MausBot" });
    expect(claudeCalls).toBe(2);
    expect(JSON.stringify(claudeBodies[1].system)).toContain("一定要用繁體中文");
  });

  it("AI 判斷跟之前存的同一個東西 → 標可能重複、回覆提醒；按過不是重複就不再比對", async () => {
    await post({ text: "Claude Code 遊戲工作室" });
    const first = tables.ideas[0];
    first.created_at = "2026-01-01T00:00:00.000Z";
    claudeOverride = { same_as: 1 };
    await post({ message_id: 3, text: "又看到 Claude Code 遊戲工作室" });
    const second = tables.ideas[1];
    expect(JSON.stringify(claudeBodies.at(-1).messages)).toContain("之前存的點子");
    expect(second.dup_of).toBe(first.id);
    expect(replies().at(-1)).toContain("可能跟之前存的一則重複");

    second.dup_of = null;
    second.dup_dismissed = true;
    const { reanalyze } = await import("@/lib/ideas");
    await reanalyze(second as any);
    expect(tables.ideas[1].dup_of).toBeNull();
    expect(JSON.stringify(claudeBodies.at(-1).messages)).not.toContain("之前存的點子");
  });

  it("AI 失敗 → 標記 failed 並告知會重試；排程重試成功", async () => {
    claudeFail = true;
    await post({ text: "https://www.threads.com/@a/post/F1" });
    expect(tables.ideas[0].status).toBe("failed");
    expect(replies().at(-1)).toContain("自動重試");

    claudeFail = false;
    tables.ideas[0].created_at = new Date(Date.now() - 3600_000).toISOString();
    const { GET } = await import("@/app/api/cron/daily/route");
    const { NextRequest } = await import("next/server");
    const bad = await GET(new NextRequest("https://x/api/cron/daily"));
    expect(bad.status).toBe(401);
    const res = await GET(new NextRequest("https://x/api/cron/daily", { headers: { authorization: "Bearer cron" } }));
    const json = await res.json();
    expect(json.retried).toBe(1);
    expect(tables.ideas[0].status).toBe("analyzed");
  });

  it("GitHub 連結：讀官方資訊、存預覽圖、強制歸類為 GitHub 資源，回覆設計格式", async () => {
    claudeOverride = { category: "ui_design", summary: "React 元件庫", styles: ["極簡", "深色模式"], learn: ["可複製的元件寫法"], apply: "ideabox 的表單元件" };
    await post({ text: "https://github.com/shadcn-ui/ui/tree/main" });
    const idea = tables.ideas[0];
    expect(idea.category).toBe("github"); // AI 說 ui_design 也會被強制改回 github
    expect(idea.url).toBe("https://github.com/shadcn-ui/ui");
    expect(idea.design.github.stars).toBe(98000);
    expect(idea.design.styles).toEqual(["極簡", "深色模式"]);
    expect(idea.image_path).toMatch(/^ideas\/.+\.png$/);
    expect(Object.keys(stored)).toHaveLength(1);
    // 有把圖片和 README 一起給 AI
    const content = claudeBodies[0].messages[0].content;
    expect(content[0].type).toBe("image");
    expect(content[1].text).toContain("Copy and paste components");
    expect(replies().at(-1)).toContain("🎨 已存入點子庫");
    expect(replies().at(-1)).toContain("⭐ 98k");
  });

  it("登入牆但有預覽圖：用圖片分析，判斷為介面設計", async () => {
    threadsHtml = `<meta property="og:description" content="Join Threads to share ideas"><meta property="og:image" content="https://cdn.example/shot.jpg">`;
    claudeOverride = { category: "ui_design", summary: "毛玻璃儀表板", styles: ["毛玻璃"], learn: ["膠囊導覽"], apply: "ideabox" };
    await post({ text: "https://www.threads.com/@d/post/UI1" });
    const idea = tables.ideas[0];
    expect(idea.status).toBe("analyzed");
    expect(idea.category).toBe("ui_design");
    expect(idea.image_path).toBeTruthy();
    expect(claudeBodies[0].messages[0].content[0].type).toBe("image");
  });

  it("讀不到內容時，回覆提示訊息傳截圖 → 補到同一則並用圖分析", async () => {
    threadsHtml = null;
    await post({ text: "https://www.instagram.com/reel/ABC123/?igsh=xx" });
    const idea = tables.ideas[0];
    expect(idea.status).toBe("needs_input");
    claudeOverride = { category: "ui_design", summary: "Reel 裡的儀表板" };
    await post({ message_id: 2, photo: [{ file_id: "F1", width: 100 }], reply_to_message: { message_id: idea.telegram_message_id } });
    expect(tables.ideas).toHaveLength(1);
    expect(tables.ideas[0].image_path).toBeTruthy();
    expect(tables.ideas[0].category).toBe("ui_design");
    expect(claudeBodies.at(-1).messages[0].content[0].type).toBe("image");
  });

  it("/top 不會把設計類算進點子排名", async () => {
    claudeOverride = { category: "ui_design", summary: "設計A" };
    await post({ text: "https://www.threads.com/@d/post/D1" });
    claudeOverride = { summary: "點子B" };
    await post({ text: "https://www.threads.com/@d/post/D2" });
    await post({ text: "/top" });
    const top = replies().at(-1)!;
    expect(top).toContain("點子B");
    expect(top).not.toContain("設計A");
  });

  it("截止提醒：14 天前提醒一次，不會重複", async () => {
    const { taipeiDate } = await import("@/lib/dates");
    const d = new Date(`${taipeiDate()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 10);
    tables.grants.push({ id: "g1", dedupe_key: "k", name: "U-start", deadline: d.toISOString().slice(0, 10), status: "new", reminded_14: false, reminded_3: false });
    const { sendDeadlineReminders } = await import("@/lib/grants");
    expect(await sendDeadlineReminders()).toBe(1);
    expect(await sendDeadlineReminders()).toBe(0);
    expect(tables.grants[0].reminded_14).toBe(true);
  });
});
