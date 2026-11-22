// 發文排程器：指令解析、時間、AI 草稿、Telegram 提醒與按鈕、網頁動作
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, stored, tables } from "./support/fakeDb";
import { CAPTION_MARK, captionOf, dueIso, duePosts, formatsFor, groupByDay, guessFormat, guessPlatform, imagesOf, parsePostCommand, postponed, reminderTexts, taipeiParts, weekDays, weekStart, type Post } from "@/lib/postLogic";
import { checkCaption, cleanInvisible } from "@/lib/captionCheck";
import { parseProjectCommand, type Project } from "@/lib/projectLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
let canEdit = true;
const failMethods = new Set<string>();
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => ({ email: "me" }),
  requireProjectEdit: async () => {
    if (!canEdit) throw new Error("沒有權限");
    return { owner: true };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";
process.env.ANTHROPIC_API_KEY = "k";
process.env.APP_URL = "https://box.example";

const TODAY = "2026-11-19";
const FIT_ID = "11111111-1111-1111-1111-111111111111";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發"], stage: 1, next_step: null, status: "active", folder: null, repo: null, sort: 10,
  last_activity_at: new Date().toISOString(), stale_asked_at: null, description: "每週幫你排一次運動的小工具", links: { website: "https://fit.example/" }, ...over,
});
const post = (over: Partial<Post> = {}): Post => ({
  id: "33333333-3333-3333-3333-333333333333", project_id: FIT_ID, platform: "fb_group", target: "運動社團", due_at: dueIso("2026-11-21", "20:00")!, topic: "常見問題",
  body: "大家好，整理一下常見問題", image_path: null, status: "scheduled", notified_at: null, posted_at: null, source: "manual", created_at: "", updated_at: "", ...over,
});

let sent: Array<{ method: string; body: any }> = [];
let claudeBodies: any[] = [];
let claudeText = "這是 AI 寫的草稿";

beforeEach(() => {
  reset();
  sent = [];
  claudeBodies = [];
  claudeText = "這是 AI 寫的草稿";
  canEdit = true;
  tables.projects.push({ ...proj() });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      const method = u.split("/").pop()!;
      sent.push({ method, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (failMethods.has(method)) return Response.json({ ok: false, description: "測試：這個方法失敗" });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }
    if (u.startsWith("https://api.anthropic.com/")) {
      claudeBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ content: [{ type: "text", text: claudeText }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error("unexpected fetch " + u);
  });
});

describe("發文排程：規則", () => {
  it("時間：台北時間存成 ISO、再換回來；延後 1 天", () => {
    const iso = dueIso("2026-11-21", "20:00")!;
    expect(iso).toBe("2026-11-21T12:00:00.000Z");
    expect(taipeiParts(iso)).toEqual({ date: "2026-11-21", time: "20:00" });
    expect(taipeiParts("2026-11-21T17:30:00.000Z")).toEqual({ date: "2026-11-22", time: "01:30" });
    expect(dueIso("2026-02-30", "20:00")).toBeNull();
    expect(dueIso("2026-11-21", "25:00")).toBeNull();
    expect(taipeiParts(postponed(iso))).toEqual({ date: "2026-11-22", time: "20:00" });
  });
  it("從「發在哪裡」猜平台", () => {
    expect(guessPlatform("中山社團")).toBe("fb_group");
    expect(guessPlatform("官方粉專")).toBe("fb_page");
    expect(guessPlatform("IG限動")).toBe("ig");
    expect(guessPlatform("Dcard中山版")).toBe("dcard");
    expect(guessPlatform("LINE動態")).toBe("line_oa");
    expect(guessPlatform("light社")).toBe("fb_group"); // 不會因為字裡有 ig 就當成 IG
  });
  it("Telegram 指令：日期、時間（可省略）、發在哪裡、主題", () => {
    expect(parsePostCommand("11/21 20:00 中山社團 常見問題 整理", TODAY)).toEqual({ date: "2026-11-21", time: "20:00", target: "中山社團", topic: "常見問題 整理", platform: "fb_group", format: "post" });
    expect(parsePostCommand("11/23 IG限動 怎麼玩 5 步驟", TODAY)).toMatchObject({ time: "20:00", platform: "ig", topic: "怎麼玩 5 步驟" });
    expect(parsePostCommand("1/5 9:30 粉專 新年", TODAY)).toMatchObject({ date: "2027-01-05", time: "09:30", platform: "fb_page" });
    expect(parsePostCommand("11/21 中山社團", TODAY)).toBeNull(); // 沒有主題
    expect(parsePostCommand("明天 中山社團 主題", TODAY)).toBeNull();
    const cmd = parseProjectCommand("fit 發文 11/21 20:00 中山社團 常見問題", [proj()], TODAY);
    expect(cmd).toMatchObject({ action: "post", value: { target: "中山社團", topic: "常見問題" } });
    expect(parseProjectCommand("fit 發文 亂打", [proj()], TODAY)).toMatchObject({ action: "error" });
    expect(parseProjectCommand("fit 發文很重要的功能", [proj()], TODAY)).toBeNull(); // 是點子，不是指令
  });
  it("時間到的貼文：只有已排定、還沒提醒過的；依日期分組", () => {
    const now = Date.parse(dueIso("2026-11-21", "20:03")!);
    const list = [post({ id: "a" }), post({ id: "b", status: "draft" }), post({ id: "c", notified_at: "x" }), post({ id: "d", due_at: dueIso("2026-11-21", "21:00")! }), post({ id: "e", due_at: dueIso("2026-11-20", "09:00")! })];
    expect(duePosts(list, now).map((p) => p.id)).toEqual(["e", "a"]);
    expect(groupByDay(list).map((g) => [g.date, g.posts.length])).toEqual([["2026-11-20", 1], ["2026-11-21", 4]]);
  });
  it("提醒文字：說明發在哪裡與為什麼要自己貼；文案單獨一則", () => {
    const t = reminderTexts(post({ target: "https://facebook.com/groups/x", body: "A <b> & B" }), "Fit");
    expect(t.head).toContain("該發文了");
    expect(t.head).toContain('<a href="https://facebook.com/groups/x">');
    expect(t.head).toContain("FB 社團不開放程式自動發文");
    expect(t.head).toContain("11/21 20:00");
    expect(t.body).toBe("A &lt;b&gt; &amp; B");
    expect(reminderTexts(post({ platform: "ig", body: "" }), "Fit").head).toContain("之後可接 Meta API");
  });
  it("多張圖：第一張在 image_path、其他照順序；改順序、拿掉會刪檔；只有一張時不帶新欄位", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { createPost, updatePost, deletePost, imageToken, pathFromToken, resolveImages } = await import("@/lib/posts");
    const base = { platform: "threads" as const, target: "", date: "2026-11-21", time: "21:00", topic: "招募", body: "內文", status: "scheduled" as const };
    for (const k of ["a", "b", "c", "d", "x"]) stored[`ideas/${k}.png`] = Buffer.from("x");
    const one = await createPost("p1", { ...base, images: ["ideas/x.png"] });
    expect(one.post?.image_path).toBe("ideas/x.png");
    expect("extra_images" in tables.project_posts.find((r) => r.id === one.post!.id)!).toBe(false);
    const a = await createPost("p1", { ...base, images: ["ideas/a.png", "ideas/b.png", "ideas/c.png"] });
    expect(imagesOf(a.post!)).toEqual(["ideas/a.png", "ideas/b.png", "ideas/c.png"]);
    expect(a.post).toMatchObject({ image_path: "ideas/a.png", extra_images: ["ideas/b.png", "ideas/c.png"] });
    // 不給 images＝不動
    expect(imagesOf((await updatePost(a.post!, { ...base, topic: "改主題" })).post!)).toHaveLength(3);
    // 調順序、拿掉 b、加 d
    const b = await updatePost(a.post!, { ...base, images: ["ideas/c.png", "ideas/a.png", "ideas/d.png"] });
    expect(imagesOf(b.post!)).toEqual(["ideas/c.png", "ideas/a.png", "ideas/d.png"]);
    expect(stored["ideas/b.png"]).toBeUndefined();
    expect(stored["ideas/a.png"]).toBeDefined();
    // 瀏覽器送來的清單：自己的路徑或剛上傳的簽章才收
    const tok = imageToken("ideas/new.png");
    expect(pathFromToken(tok)).toBe("ideas/new.png");
    expect(pathFromToken("ideas/other.png#" + "0".repeat(32))).toBeNull();
    expect(resolveImages(["ideas/c.png", tok], b.post!)).toEqual(["ideas/c.png", "ideas/new.png"]);
    expect(resolveImages(["ideas/別人的.png"], b.post!)).toBeNull();
    expect(resolveImages(Array(11).fill(tok), b.post!)).toBeNull();
    await deletePost(b.post!);
    expect([stored["ideas/c.png"], stored["ideas/a.png"], stored["ideas/d.png"]]).toEqual([undefined, undefined, undefined]);
  });
  it("Threads：猜得到平台、只有一般貼文、超過 500 字要改；備註跟提醒一起傳", async () => {
    expect(guessPlatform("Threads")).toBe("threads");
    expect(guessPlatform("脆")).toBe("threads");
    expect(formatsFor("threads")).toEqual(["post"]);
    expect(checkCaption("字".repeat(501), "threads").items.some((i) => i.key === "long" && i.level === "fail")).toBe(true);
    expect(checkCaption("字".repeat(400) + "\n留言 +1", "threads").items.some((i) => i.key === "long")).toBe(false);
    const t = reminderTexts(post({ platform: "threads", note: "配圖在桌面 <A>\n發完自己回第一則" }), "Fit");
    expect(t.head).toContain("Fit・Threads");
    expect(t.head).toContain("📝 <b>備註</b>\n配圖在桌面 &lt;A&gt;\n發完自己回第一則");
    expect(t.body).not.toContain("配圖");
    expect(reminderTexts(post({ platform: "threads" }), "Fit").head).not.toContain("備註");
    const { createPost, updatePost } = await import("@/lib/posts");
    const a = await createPost("p1", { platform: "threads", target: "", date: "2026-11-21", time: "21:00", topic: "招募", body: "內文", status: "scheduled", note: "  記得回第一則  " });
    expect(a.post).toMatchObject({ platform: "threads", note: "記得回第一則", status: "scheduled", due_at: "2026-11-21T13:00:00.000Z" });
    const b = await createPost("p1", { platform: "threads", target: "", date: "2026-11-23", time: "21:00", topic: "追蹤", body: "", status: "draft" });
    expect("note" in tables.project_posts.find((r) => r.id === b.post!.id)!).toBe(false);
    const c = await updatePost(a.post!, { platform: "threads", target: "", date: "2026-11-21", time: "21:00", topic: "招募", body: "內文", status: "scheduled", note: "" });
    expect(c.post?.note).toBe("");
  });
});

describe("發文排程：流程", () => {
  it("AI 草稿：帶專案描述、主題、平台格式與之前的貼文當語氣參考", async () => {
    const { draftPost, cleanDraft } = await import("@/lib/posts");
    tables.project_posts.push({ ...post({ id: "old", body: "之前自己寫的一篇貼文，口氣很隨性，大概就是聊聊為什麼做這個東西，然後請大家來試試看，有問題可以直接留言問我，真的不用客氣喔。" }) });
    claudeText = "以下是草稿：\n\n**嗨**大家，這週想聊聊運動";
    const d = await draftPost(proj(), { platform: "dcard", target: "Dcard 健身版", topic: "為什麼一週排一次就夠" });
    expect(d).toBe("嗨大家，這週想聊聊運動");
    const b = claudeBodies[0];
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.system).toContain("不要用這些 AI 常見寫法");
    expect(b.system).toContain("Dcard 文章");
    const user = b.messages[0].content as string;
    expect(user).toContain("每週幫你排一次運動的小工具");
    expect(user).toContain("為什麼一週排一次就夠");
    expect(user).toContain("https://fit.example/");
    expect(user).toContain("之前自己寫的一篇貼文");
    expect(tables.ai_usage[0].purpose).toBe("post_draft");
    expect(cleanDraft("「整篇被引號包住」")).toBe("整篇被引號包住");
  });

  it("Telegram 新增：寫草稿、排定、回覆草稿與修改連結", async () => {
    const { handleProjectText } = await import("@/lib/projects");
    // 指令裡的「11/21」是照今天往後推的，所以把今天固定在 11/20（不然過了那天會被算成明年）
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T04:00:00Z") });
    const reply = await handleProjectText("fit 發文 11/21 20:00 中山社團 常見問題整理").finally(() => vi.useRealTimers());
    expect(reply).toContain("已排定發文：11/21 20:00・FB 社團・中山社團");
    expect(reply).toContain("這是 AI 寫的草稿");
    expect(reply).toContain("https://box.example/social?p=fit&view=posts");
    expect(tables.project_posts[0]).toMatchObject({ project_id: FIT_ID, platform: "fb_group", target: "中山社團", topic: "常見問題整理", body: "這是 AI 寫的草稿", status: "scheduled", source: "telegram", due_at: "2026-11-21T12:00:00.000Z" });
    expect(await handleProjectText("fit 發文 亂打")).toContain("格式：發文");
  });

  it("時間到：先說明、有圖傳圖、再傳完整文案加三個按鈕；不重複提醒", async () => {
    const { runPostReminders } = await import("@/lib/posts");
    tables.project_posts.push({ ...post({ image_path: "ideas/2026-11/x.jpg" }) }, { ...post({ id: "44444444-4444-4444-4444-444444444444", status: "draft" }) });
    const now = Date.parse(dueIso("2026-11-21", "20:02")!);
    expect(await runPostReminders(now - 10 * 60_000)).toBe(0); // 還沒到
    expect(await runPostReminders(now)).toBe(1);
    expect(sent.map((s) => s.method)).toEqual(["sendMessage", "sendPhoto", "sendMessage"]);
    expect(sent[0].body.text).toContain("該發文了");
    expect(sent[1].body.photo).toBe("https://signed/ideas/2026-11/x.jpg");
    expect(sent[2].body.text).toBe("大家好，整理一下常見問題");
    expect(sent[2].body.reply_markup.inline_keyboard[0].map((b: { text: string }) => b.text)).toEqual(["✅ 已發", "⏰ 延後 1 天", "🚫 略過"]);
    expect(sent[2].body.reply_markup.inline_keyboard[0].every((b: { callback_data: string }) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
    expect(tables.project_posts[0].notified_at).not.toBeNull();
    expect(await runPostReminders(now + 5 * 60_000)).toBe(0);
  });

  it("按鈕：已發、延後 1 天（隔天再提醒）、略過", async () => {
    const { handleCallback } = await import("@/lib/tgFlow");
    const { runPostReminders } = await import("@/lib/posts");
    const p = post({ notified_at: "2026-11-21T12:02:00.000Z" });
    tables.project_posts.push({ ...p });
    const cb = (data: string) => ({ id: "c1", data, message: { message_id: 9, chat: { id: 111 } }, from: { id: 111 } }) as never;
    await handleCallback(cb(`po:d:${p.id}`));
    expect(tables.project_posts[0]).toMatchObject({ status: "scheduled", notified_at: null, due_at: "2026-11-22T12:00:00.000Z" });
    expect(sent.at(-1)!.body.text).toContain("延後到 11/22 20:00");
    expect(await runPostReminders(Date.parse("2026-11-22T12:01:00.000Z"))).toBe(1);
    await handleCallback(cb(`po:p:${p.id}`));
    expect(tables.project_posts[0].status).toBe("posted");
    expect(tables.project_posts[0].posted_at).not.toBeNull();
    await handleCallback(cb(`po:s:${p.id}`));
    expect(tables.project_posts[0].status).toBe("skipped");
    await handleCallback(cb("po:p:00000000-0000-0000-0000-000000000000"));
    expect(sent.filter((s) => s.method === "answerCallbackQuery").at(-1)!.body.text).toContain("已經不在排程裡");
  });

  it("時間到：兩張以上的圖合成一組相簿、照順序；相簿傳不出去就一張一張傳", async () => {
    const { runPostReminders } = await import("@/lib/posts");
    tables.project_posts.push({ ...post({ image_path: "ideas/1.png", extra_images: ["ideas/2.png", "ideas/3.png"] }) });
    const now = Date.parse(dueIso("2026-11-21", "20:02")!);
    expect(await runPostReminders(now)).toBe(1);
    expect(sent.map((s) => s.method)).toEqual(["sendMessage", "sendMediaGroup", "sendMessage"]);
    expect(sent[1].body.media).toEqual(["1", "2", "3"].map((n) => ({ type: "photo", media: `https://signed/ideas/${n}.png` })));
    const { sendPhotos } = await import("@/lib/telegram");
    sent.length = 0;
    failMethods.add("sendMediaGroup");
    expect(await sendPhotos(1, ["https://a/1", "https://a/2"])).toBe(2);
    expect(sent.map((s) => s.method)).toEqual(["sendMediaGroup", "sendPhoto", "sendPhoto"]);
    failMethods.clear();
  });

  it("網頁動作：新增（含圖片）、修改後重新等提醒、狀態、刪除；沒權限不能改", async () => {
    const a = await import("@/app/(dash)/social/actions");
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]).toString("base64")}`;
    const v = { platform: "ig" as const, target: "官方 IG", date: "2026-11-23", time: "21:00", topic: "怎麼玩", body: "五個步驟", status: "scheduled" as const };
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const up = await a.uploadPostImageAction(FIT_ID, png);
    const up2 = await a.uploadPostImageAction(FIT_ID, png);
    expect(up.ok && up2.ok).toBe(true);
    expect((await a.savePostAction(FIT_ID, null, { ...v, images: [up.token!, up2.token!] })).ok).toBe(true);
    const row = tables.project_posts[0];
    expect(row.extra_images).toHaveLength(1);
    expect((await a.savePostAction(FIT_ID, null, { ...v, images: ["ideas/亂塞的路徑.png"] })).ok).toBe(false);
    expect(row).toMatchObject({ platform: "ig", status: "scheduled", due_at: "2026-11-23T13:00:00.000Z" });
    expect(Object.keys(stored)).toContain(row.image_path);
    expect((await a.savePostAction(FIT_ID, null, { ...v, topic: "", body: "" })).ok).toBe(false);
    expect((await a.uploadPostImageAction(FIT_ID, "data:image/png;base64,AAAA")).error).toContain("只接受");

    row.notified_at = "x";
    expect((await a.savePostAction(FIT_ID, row.id, { ...v, time: "22:00" })).ok).toBe(true); // 改時間 → 重新等提醒；沒動圖片 → 圖片留著
    expect(tables.project_posts[0]).toMatchObject({ notified_at: null, due_at: "2026-11-23T14:00:00.000Z", image_path: row.image_path });
    expect((await a.setPostStatusAction(row.id, "posted")).ok).toBe(true);
    expect(tables.project_posts[0].status).toBe("posted");
    expect((await a.postponePostAction(row.id)).ok).toBe(true);
    expect(tables.project_posts[0]).toMatchObject({ status: "scheduled", due_at: "2026-11-24T14:00:00.000Z" });
    expect((await a.draftPostAction(FIT_ID, { platform: "ig", target: "", topic: "怎麼玩" })).draft).toBe("這是 AI 寫的草稿");
    expect((await a.draftPostAction(FIT_ID, { platform: "ig", target: "", topic: "" })).ok).toBe(false);

    // 格式：IG 可以存 Reel；FB 社團沒有限動，當作一般貼文
    expect((await a.savePostAction(FIT_ID, row.id, { ...v, format: "reel" })).ok).toBe(true);
    expect(tables.project_posts[0].format).toBe("reel");
    expect((await a.savePostAction(FIT_ID, null, { ...v, platform: "fb_group", format: "story", body: "零\u200B寬" })).ok).toBe(true);
    expect(tables.project_posts[1].format ?? "post").toBe("post");
    expect(tables.project_posts[1].body).toBe("零寬"); // 看不見的字元存檔時清掉
    tables.project_posts.pop();

    canEdit = false;
    await expect(a.setPostStatusAction(row.id, "skipped")).rejects.toThrow("沒有權限");
    await expect(a.savePostAction(FIT_ID, null, v)).rejects.toThrow("沒有權限");
    canEdit = true;
    expect((await a.deletePostAction(row.id)).ok).toBe(true);
    expect(tables.project_posts).toHaveLength(0);
    expect(Object.keys(stored)).not.toContain(row.image_path);
  });
});

describe("社群助手：格式、腳本與一週看板", () => {
  it("格式：哪些平台有、從「發在哪裡」猜、Telegram 指令帶格式", () => {
    expect(formatsFor("ig")).toEqual(["post", "reel", "carousel", "story"]);
    expect(formatsFor("fb_group")).toEqual(["post"]);
    expect(guessFormat("IG Reel", "ig")).toBe("reel");
    expect(guessFormat("IG 限動", "ig")).toBe("story");
    expect(guessFormat("官方 IG 輪播", "ig")).toBe("carousel");
    expect(guessFormat("社團限動", "fb_group")).toBe("post");
    expect(parsePostCommand("11/21 20:00 IG限動 今天的進度", TODAY)).toMatchObject({ platform: "ig", format: "story" });
    expect(parsePostCommand("11/21 中山社團 常見問題", TODAY)).toMatchObject({ platform: "fb_group", format: "post" });
    expect(reminderTexts(post({ platform: "ig", format: "reel" }), "Fit").head).toContain("IG・Reel 短影片");
  });

  it("AI 寫腳本：用格式的規則，不拿腳本當語氣參考", async () => {
    const { draftPost } = await import("@/lib/posts");
    tables.project_posts.push({ ...post({ id: "old", format: "reel", body: "【開頭三選一】舊的腳本內容舊的腳本內容舊的腳本內容舊的腳本內容舊的腳本內容舊的腳本內容舊的腳本內容舊的腳本內容" }) });
    await draftPost(proj(), { platform: "ig", format: "reel", target: "", topic: "第一次排運動" });
    const b = claudeBodies[0];
    expect(b.system).toContain("【開頭三選一】");
    expect(b.system).toContain(CAPTION_MARK);
    expect(b.system).not.toContain("IG 貼文說明：前兩行");
    expect(b.messages[0].content).not.toContain("舊的腳本內容");
    expect(b.max_tokens).toBe(2500);
  });

  it("一週看板：星期一開始的 7 天", () => {
    expect(weekStart("2026-11-19")).toBe("2026-11-16"); // 星期四
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // 星期日算同一週
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekDays("2026-11-30")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  });
});

describe("社群助手：文案檢查", () => {
  const keys = (r: ReturnType<typeof checkCaption>) => r.items.map((i) => i.key);

  it("乾淨的 IG 貼文通過；算出「更多」前面露出的字", () => {
    const r = checkCaption("上週排了三次運動，只去了一次。\n\n後來改成一週只排一次，反而每次都有去。\n\n想看我怎麼排的，留言「排」我傳給你。\n\n#運動習慣 #大學生活", "ig");
    expect(r.verdict).toBe("ok");
    expect(r.visible.startsWith("上週排了三次運動，只去了一次。 後來改成")).toBe(true);
    expect(r.hashtags).toHaveLength(2);
    expect(r.asks).toEqual(["comment"]);
    expect(checkCaption("想試試看的話，主頁有連結", "ig").asks).toEqual(["link"]);
  });

  it("IG：連結、太多 hashtag 要改；沒行動、打招呼開頭、AI 腔、破折號提醒", () => {
    const tags = Array.from({ length: 7 }, (_, i) => `#標籤${i}`).join(" ");
    const r = checkCaption(`大家好，今天想聊聊運動。\n這不只是運動，更是一種生活——讓我們一起探索。\n看這裡 https://fit.example/go\n${tags} #fyp`, "ig");
    expect(r.verdict).toBe("fail");
    expect(keys(r)).toEqual(expect.arrayContaining(["link", "tags", "generic", "greeting", "slop", "dash", "noask"]));
    expect(r.items.find((i) => i.key === "link")!.level).toBe("fail");
    // FB 社團可以放連結，hashtag 也不擋
    const fb = checkCaption("整理了常見問題，加好友從這裡 https://fit.example/go", "fb_group");
    expect(keys(fb)).not.toContain("link");
    expect(fb.verdict).toBe("ok");
  });

  it("第一段太長會被切、表情符號太密、一次要太多件事", () => {
    expect(keys(checkCaption(`${"很長的第一段".repeat(25)}\n留言告訴我`, "ig"))).toContain("cut");
    expect(keys(checkCaption("好棒🔥🔥🔥🎉🎉 留言", "ig"))).toContain("emoji");
    expect(keys(checkCaption("留言＋收藏，再追蹤我，然後私訊我拿連結在主頁的表單", "ig"))).toContain("asks");
  });

  it("腳本只檢查「貼文說明」那段；限動沒有說明；看不見的字元", () => {
    const script = `【開頭三選一】\n1. 我排了三次只去一次\n【口白】\n後來我改了一件事\n${CAPTION_MARK}\n留言「排」我傳給你。\n#運動習慣`;
    expect(captionOf(script, "reel")).toBe("留言「排」我傳給你。\n#運動習慣");
    expect(checkCaption(script, "ig", "reel").verdict).toBe("ok");
    expect(keys(checkCaption("【開頭三選一】\n1. 一句話", "ig", "reel"))).toEqual(["nocaption"]);
    expect(checkCaption("【第 1 格】自拍｜今天第三次", "ig", "story")).toMatchObject({ verdict: "ok", hasCaption: false });
    expect(checkCaption("", "ig").verdict).toBe("empty");
    expect(cleanInvisible("a\u200Bb\uFEFFc\u00A0d ❤️ 👨‍👩‍👧")).toEqual({ text: "abc d ❤️ 👨‍👩‍👧", removed: 3 });
    expect(keys(checkCaption("留言\u200B給我", "fb_group"))).toContain("invisible");
  });
});
