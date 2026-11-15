// 點子庫資料夾：AI 自動歸檔、手動搬移、Telegram 資料夾按鈕、網頁上的資料夾操作
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import { cleanFolderName, pickFolder, reorder, type Folder } from "@/lib/folderLogic";

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

const F = (id: string, name: string, category: string | null = null, sort = 0): Folder => ({ id, name, category, sort });

describe("資料夾規則", () => {
  const fs = [F("a", "Fit 功能靈感", "arx_feature"), F("u", "介面設計", "ui_design"), F("m", "健身社群")];
  it("AI 選的名稱優先，對不到用分類，都沒有就未分類", () => {
    expect(pickFolder(fs, "健身社群", "arx_feature")).toBe("m");
    expect(pickFolder(fs, "  介面設計 ", "arx_feature")).toBe("u");
    expect(pickFolder(fs, "不存在", "ui_design")).toBe("u");
    expect(pickFolder(fs, undefined, "marketing")).toBeNull();
    expect(pickFolder([], "健身社群", "arx_feature")).toBeNull();
  });
  it("名稱整理", () => {
    expect(cleanFolderName("  a   b ")).toBe("a b");
    expect(cleanFolderName("x".repeat(30))).toHaveLength(20);
    expect(cleanFolderName(null)).toBe("");
  });
  it("拖曳排序：往後拖放在目標後、往前拖放在目標前", () => {
    expect(reorder(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(reorder(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(reorder(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(reorder(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });
});

type Sent = { method: string; body: any };
let sent: Sent[] = [];
let msgId = 1000;
let aiFolder: string | undefined;
let aiBodies: any[] = [];

beforeEach(() => {
  reset();
  sent = [];
  aiBodies = [];
  pending.length = 0;
  aiFolder = "健身社群";
  tables.folders.push(
    { id: "11111111-1111-1111-1111-111111111111", name: "Fit 功能靈感", category: "arx_feature", sort: 10 },
    { id: "22222222-2222-2222-2222-222222222222", name: "健身社群", category: null, sort: 20 },
    { id: "33333333-3333-3333-3333-333333333333", name: "其他", category: "other", sort: 30 },
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      const method = u.split("/").pop()!;
      sent.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (method === "getWebhookInfo") return Response.json({ ok: true, result: { url: "https://x/api/telegram" } });
      return Response.json({ ok: true, result: { message_id: ++msgId } });
    }
    if (u.startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(String(init?.body));
      aiBodies.push(body);
      const input = { summary: "好友挑戰", category: "arx_feature", tags: ["社群"], score_arx: 8, score_feasibility: 7, score_market: 6, score_reason: "r", next_step: "n", ...(aiFolder ? { folder: aiFolder } : {}) };
      return Response.json({ content: [{ type: "tool_use", id: "t", name: body.tools[0].name, input }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error("unexpected fetch " + u);
  });
});

async function post(update: Record<string, unknown>) {
  const { POST } = await import("@/app/api/telegram/route");
  const req = new Request("https://x/api/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret", "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  await POST(req as any);
  await Promise.all(pending);
  pending.length = 0;
}
const message = (text: string, id = 1) => ({ message: { message_id: id, chat: { id: 111, type: "private" }, from: { id: 111 }, text } });
const press = (data: string, messageId = 999) => ({ callback_query: { id: "cb1", data, from: { id: 111 }, message: { message_id: messageId, chat: { id: 111 } } } });
const lastMessage = () => sent.filter((s) => s.method === "sendMessage").at(-1)!.body;
const buttonsOf = (m: any) => (m.reply_markup?.inline_keyboard ?? []).flat() as Array<{ text: string; callback_data: string }>;

describe("Telegram 存點子：AI 先猜資料夾、按鈕可改", () => {
  it("AI 的資料夾選項來自你的資料夾；存好放進 AI 選的那個，回覆顯示資料夾並打勾", async () => {
    await post(message("用好友挑戰提高 app 留存率"));
    const idea = tables.ideas[0];
    expect(idea.folder_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(idea.folder_locked).toBe(false);
    expect(aiBodies[0].tools[0].input_schema.properties.folder.enum).toEqual(["Fit 功能靈感", "健身社群", "其他"]);
    const m = lastMessage();
    expect(m.text).toContain("【健身社群】");
    const btns = buttonsOf(m);
    expect(btns.map((b) => b.text).slice(0, 3)).toEqual(["Fit 功能靈感", "✓ 健身社群", "其他"]);
    // 後面是模組提供的「改存到其他地點」（公開版沒有）
    expect(btns.slice(3).every((b) => b.text.includes("改存到"))).toBe(true);
  });

  it("按資料夾按鈕就搬過去並鎖定，可以再改；重新分析不會被 AI 改回去", async () => {
    await post(message("用好友挑戰提高 app 留存率"));
    const toOther = buttonsOf(lastMessage()).find((b) => b.text === "其他")!;
    await post(press(toOther.callback_data));
    expect(tables.ideas[0].folder_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(tables.ideas[0].folder_locked).toBe(true);
    const edit = sent.filter((s) => s.method === "editMessageReplyMarkup").at(-1)!.body;
    expect(edit.reply_markup.inline_keyboard.flat().map((b: any) => b.text)).toContain("✓ 其他");
    expect(sent.filter((s) => s.method === "answerCallbackQuery").at(-1)!.body.text).toContain("其他");

    // 同一組按鈕可以再按一次改到別的資料夾
    const toArx = edit.reply_markup.inline_keyboard.flat().find((b: any) => b.text === "Fit 功能靈感");
    await post(press(toArx.callback_data));
    expect(tables.ideas[0].folder_id).toBe("11111111-1111-1111-1111-111111111111");

    const { reanalyze } = await import("@/lib/ideas");
    await reanalyze(tables.ideas[0] as any);
    expect(tables.ideas[0].folder_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("AI 沒選資料夾 → 用分類對應的預設資料夾", async () => {
    aiFolder = undefined;
    await post(message("用好友挑戰提高 app 留存率"));
    expect(tables.ideas[0].folder_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("還沒執行 migration（沒有資料夾）照常存，只附改存按鈕", async () => {
    tables.folders.length = 0;
    await post(message("用好友挑戰提高 app 留存率"));
    expect(tables.ideas[0].status).toBe("analyzed");
    expect(tables.ideas[0].folder_id).toBeNull();
    expect(buttonsOf(lastMessage()).every((b) => b.text.includes("改存到"))).toBe(true);
    expect(aiBodies[0].tools[0].input_schema.properties.folder).toBeUndefined();
  });

  it("資料夾被刪掉後按舊按鈕不會出錯", async () => {
    await post(message("用好友挑戰提高 app 留存率"));
    const btn = buttonsOf(lastMessage()).find((b) => b.text === "其他")!;
    tables.folders.splice(2, 1);
    await post(press(btn.callback_data));
    expect(tables.ideas[0].folder_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(sent.filter((s) => s.method === "answerCallbackQuery").at(-1)!.body.text).toContain("搬不過去");
  });
});

describe("網頁上的資料夾操作", () => {
  it("新增（不能同名）、改名、排序、刪除後點子變未分類", async () => {
    const a = await import("@/app/(dash)/actions");
    expect((await a.createFolder("  健身社群 ")).ok).toBe(false);
    expect((await a.createFolder("")).ok).toBe(false);
    expect((await a.createFolder("競品")).ok).toBe(true);
    const created = tables.folders.find((f) => f.name === "競品")!;
    expect(created.sort).toBe(40);

    expect((await a.renameFolder(created.id, "其他")).ok).toBe(false);
    expect((await a.renameFolder(created.id, "競品觀察")).ok).toBe(true);
    expect(created.name).toBe("競品觀察");

    await a.reorderFolders([created.id, "11111111-1111-1111-1111-111111111111", "not-a-uuid"]);
    expect(created.sort).toBe(10);
    expect(tables.folders.find((f) => f.name === "Fit 功能靈感")!.sort).toBe(20);

    tables.ideas.push({ ...fakeIdea(), folder_id: created.id });
    expect((await a.deleteFolder(created.id)).ok).toBe(true);
    expect(tables.folders.some((f) => f.id === created.id)).toBe(false);
    expect(tables.ideas[0].folder_id).toBeNull();
  });

  it("搬移多則（含未分類）、擋掉不存在的資料夾", async () => {
    const a = await import("@/app/(dash)/actions");
    const i1 = fakeIdea();
    const i2 = fakeIdea();
    tables.ideas.push(i1, i2);
    const r = await a.moveIdeas([i1.id, i2.id], "22222222-2222-2222-2222-222222222222");
    expect(r).toMatchObject({ ok: true, moved: 2 });
    expect(tables.ideas.every((i) => i.folder_id === "22222222-2222-2222-2222-222222222222" && i.folder_locked)).toBe(true);
    expect((await a.moveIdeas([i1.id], "")).ok).toBe(true);
    expect(i1.folder_id).toBeNull();
    expect((await a.moveIdeas([i1.id], "44444444-4444-4444-4444-444444444444")).ok).toBe(false);
    expect((await a.moveIdeas([i1.id], "bad")).ok).toBe(false);
  });
});

let n = 0;
function fakeIdea() {
  n++;
  return {
    id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`, source: "text", status: "analyzed", category: "other", tags: [],
    adopted: false, in_brief: false, folder_id: null as string | null, folder_locked: false, analyze_attempts: 0, created_at: new Date().toISOString(),
  };
}

describe("資料夾換顏色", () => {
  it("只接受預設顏色；空字串＝跟著主題", async () => {
    const a = await import("@/app/(dash)/actions");
    const id = "22222222-2222-2222-2222-222222222222";
    expect((await a.setFolderColor(id, "pink")).ok).toBe(true);
    expect(tables.folders.find((f) => f.id === id)!.color).toBe("pink");
    expect((await a.setFolderColor(id, "#123456")).ok).toBe(false);
    expect((await a.setFolderColor(id, "")).ok).toBe(true);
    expect(tables.folders.find((f) => f.id === id)!.color).toBeNull();
  });
});
