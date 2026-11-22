// 衝刺提醒：到期限前每天早上 8 點、晚上 9 點半各傳一則「倒數＋今天該做什麼」
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import { parseProjectCommand, type Milestone, type Project } from "@/lib/projectLogic";
import { cleanSprints, planSprint, shouldSend, slotAt, sprintMessage, type Sprint } from "@/lib/sprintLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => void fn() };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const CAFE_ID = "22222222-2222-2222-2222-222222222222";
const id = (n: number) => `${String(n).repeat(8)}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`;
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發"], stage: 1, next_step: null, status: "active", folder: null, repo: null, sort: 10,
  last_activity_at: "2026-11-01T00:00:00.000Z", stale_asked_at: null, ...over,
});
const ms = (n: number, title: string, due: string | null, over: Partial<Milestone> = {}): Milestone => ({ id: id(n), project_id: FIT_ID, title, due, done: false, reminded_7: true, reminded_1: true, ...over });
const SPRINT: Sprint = { project: FIT_ID, due: "2026-11-30", title: "報名截止", time: "12:00" };
const TODAY = "2026-11-21";
const list = () => [
  ms(1, "寫講稿", "2026-11-20"),
  ms(2, "拍影片", "2026-11-21"),
  ms(3, "剪影片", "2026-11-22"),
  ms(4, "排版", "2026-11-25"),
  ms(5, "要到同意書", "2026-11-16", { done: true }),
  ms(6, "查機票", null),
  ms(7, "出發", "2027-08-02"),
  ms(8, "別的專案的事", "2026-11-21", { project_id: CAFE_ID }),
];

// 台北 2026-11-21 08:05、21:35、07:00
const MORNING = Date.parse("2026-11-21T00:05:00Z");
const NIGHT = Date.parse("2026-11-21T13:35:00Z");
const EARLY = Date.parse("2026-11-20T23:00:00Z");
const cb = (data: string) => ({ id: "c1", data, message: { message_id: 9, chat: { id: 111 } }, from: { id: 111 } }) as never;

let sent: Array<{ method: string; body: any }> = [];
let tgOk = true;

beforeEach(() => {
  reset();
  sent = [];
  tgOk = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      sent.push({ method: u.split("/").pop()!, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return tgOk ? Response.json({ ok: true, result: { message_id: sent.length } }) : Response.json({ ok: false }, { status: 500 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
});

describe("衝刺提醒的規則", () => {
  it("時段：8 點前不傳，早上、晚上各一次", () => {
    expect(slotAt(7 * 60 + 59)).toBeNull();
    expect(slotAt(8 * 60)).toBe("am");
    expect(slotAt(21 * 60 + 29)).toBe("am");
    expect(slotAt(21 * 60 + 30)).toBe("pm");
    expect(shouldSend("am", TODAY, null)).toBe(true);
    expect(shouldSend("am", TODAY, "2026-11-20:pm")).toBe(true);
    expect(shouldSend("am", TODAY, `${TODAY}:am`)).toBe(false);
    expect(shouldSend("pm", TODAY, `${TODAY}:am`)).toBe(true);
    expect(shouldSend("pm", TODAY, `${TODAY}:pm`)).toBe(false);
  });

  it("設定：壞掉的、重複專案的丟掉", () => {
    expect(cleanSprints(JSON.stringify([SPRINT, { ...SPRINT, due: "2026-12-01" }, { project: CAFE_ID, due: "亂寫" }, null]))).toEqual([SPRINT]);
    expect(cleanSprints("不是 JSON")).toEqual([]);
    expect(cleanSprints([{ project: CAFE_ID, due: "2026-12-01", time: "25點" }])).toEqual([{ project: CAFE_ID, due: "2026-12-01", title: "期限", time: null }]);
  });

  it("分類：過期、今天、接下來、沒日期；期限之後和別的專案的不算", () => {
    const plan = planSprint(SPRINT, list(), [], TODAY);
    expect(plan.daysLeft).toBe(9);
    expect(plan.overdue.map((m) => m.title)).toEqual(["寫講稿"]);
    expect(plan.today.map((m) => m.title)).toEqual(["拍影片"]);
    expect(plan.upcoming.map((m) => m.title)).toEqual(["剪影片", "排版"]);
    expect(plan.undated.map((m) => m.title)).toEqual(["查機票"]);
    expect([plan.done, plan.total]).toEqual([1, 6]);
  });

  it("早上的訊息：倒數、過期先補、今天要做完、接下來，按鈕只放過期和今天的", () => {
    const events = [{ id: "e1", project_id: FIT_ID, title: "拍片週", start_date: "2026-11-20", end_date: "2026-11-24", source: "manual" as const }];
    const m = sprintMessage(proj(), SPRINT, planSprint(SPRINT, list(), events, TODAY), "am", TODAY, "https://x.test/");
    expect(m.html).toContain("Fit｜報名截止・倒數 9 天");
    expect(m.html).toContain("期限：11/30（一） 12:00・待辦完成 1／6");
    expect(m.html).toContain("寫講稿（11/20，過了 1 天）");
    expect(m.html).toContain("1. 拍影片");
    expect(m.html).toContain("拍片週（11/20～11/24）");
    expect(m.html).toContain("11/22（日）剪影片");
    expect(m.html).toContain("沒排日期的還有 1 件：查機票");
    expect(m.html).not.toContain("出發");
    expect(m.html).toContain("https://x.test/projects/fit");
    expect(m.buttons.map((r) => r[0].data)).toEqual([`sp:d:a:${id(1)}`, `sp:d:a:${id(2)}`, `sp:e:${FIT_ID}`]);
    expect(m.push).toEqual({ title: "🔥 Fit｜報名截止・倒數 9 天", body: "今天：寫講稿、拍影片" });
    for (const r of m.buttons) expect(Buffer.byteLength(r[0].data)).toBeLessThanOrEqual(64);
  });

  it("今天沒有到期的事：提下一件；最後一天和前一天寫明時間；全部做完請他按停止", () => {
    const later = [ms(3, "剪影片", "2026-11-23"), ms(4, "排版", "2026-11-25")];
    const m = sprintMessage(proj(), SPRINT, planSprint(SPRINT, later, [], TODAY), "am", TODAY);
    expect(m.html).toContain("今天沒有到期的事，可以先做下一件");
    expect(m.html).toContain("剪影片（11/23 到期）");
    expect(m.html).toContain("11/25（三）排版");
    expect(m.buttons[0][0].data).toBe(`sp:d:a:${id(3)}`);

    expect(sprintMessage(proj(), SPRINT, planSprint(SPRINT, later, [], "2026-11-29"), "am", "2026-11-29").html).toContain("報名截止・明天 12:00 截止");
    expect(sprintMessage(proj(), SPRINT, planSprint(SPRINT, later, [], "2026-11-30"), "am", "2026-11-30").html).toContain("報名截止・今天 12:00 截止");

    const done = sprintMessage(proj(), SPRINT, planSprint(SPRINT, [ms(1, "送件", "2026-11-27", { done: true })], [], TODAY), "pm", TODAY);
    expect(done.html).toContain("清單上的事都做完了");
    expect(done.buttons).toEqual([[{ text: "🏁 已經完成，停止提醒", data: `sp:e:${FIT_ID}` }]]);
  });

  it("晚上的訊息：今天還沒打勾的＋明天要做完的", () => {
    const m = sprintMessage(proj(), SPRINT, planSprint(SPRINT, list(), [], TODAY), "pm", TODAY);
    expect(m.html).toContain("🌙");
    expect(m.html).toContain("今天還沒打勾");
    expect(m.html).toContain("寫講稿（11/20 就該做完）");
    expect(m.html).toContain("明天要做完");
    expect(m.html).toContain("剪影片");
    expect(m.buttons[0][0].data).toBe(`sp:d:p:${id(1)}`);

    const clear = sprintMessage(proj(), SPRINT, planSprint(SPRINT, [ms(4, "排版", "2026-11-25")], [], TODAY), "pm", TODAY);
    expect(clear.html).toContain("今天該做的都打勾了");
    expect(clear.html).toContain("下一件：11/25 排版");
  });

  it("Telegram 指令：衝刺 日期 [時間] 標題／取消", () => {
    const ps = [proj()];
    expect(parseProjectCommand("fit 衝刺 11/30 12:00 報名截止", ps, TODAY)).toMatchObject({ action: "sprint", due: "2026-11-30", time: "12:00", value: "報名截止" });
    expect(parseProjectCommand("fit 衝刺 12/5 上架", ps, TODAY)).toMatchObject({ action: "sprint", due: "2026-12-05", time: null, value: "上架" });
    expect(parseProjectCommand("fit 衝刺 12/5", ps, TODAY)).toMatchObject({ action: "sprint", value: "期限" });
    expect(parseProjectCommand("fit 衝刺 取消", ps, TODAY)).toMatchObject({ action: "sprintOff" });
    expect(parseProjectCommand("fit 衝刺", ps, TODAY)).toMatchObject({ action: "error" });
    expect(parseProjectCommand("fit 衝刺一下這個功能", ps, TODAY)).toBeNull();
  });
});

describe("衝刺提醒的排程與按鈕", () => {
  const seed = () => {
    tables.projects.push({ ...proj() }, { ...proj({ id: CAFE_ID, slug: "cafe", name: "Cafe" }) });
    tables.project_milestones.push(...list().map((m) => ({ ...m })));
    tables.settings.push({ key: "sprints", value: JSON.stringify([SPRINT]) });
  };
  const messages = () => sent.filter((s) => s.method === "sendMessage");

  it("早上、晚上各傳一次，同一個時段不重複；8 點前不傳", async () => {
    const { runSprint } = await import("@/lib/sprint");
    seed();
    expect(await runSprint(EARLY)).toBe(0);
    expect(await runSprint(MORNING)).toBe(1);
    expect(await runSprint(MORNING + 5 * 60_000)).toBe(0);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].body.text).toContain("🔥 <b>Fit｜報名截止・倒數 9 天</b>");
    expect(messages()[0].body.reply_markup.inline_keyboard).toHaveLength(3);
    expect(await runSprint(NIGHT)).toBe(1);
    expect(await runSprint(NIGHT + 5 * 60_000)).toBe(0);
    expect(messages()[1].body.text).toContain("今天還沒打勾");
  });

  it("傳失敗下次再試；過了期限自動結束；暫停的專案不提醒", async () => {
    const { runSprint, listSprints } = await import("@/lib/sprint");
    seed();
    tgOk = false;
    expect(await runSprint(MORNING)).toBe(0);
    tgOk = true;
    expect(await runSprint(MORNING)).toBe(1);

    tables.projects[0].status = "paused";
    expect(await runSprint(NIGHT)).toBe(0);
    tables.projects[0].status = "active";

    // 12/1 早上：期限過了
    expect(await runSprint(Date.parse("2026-12-01T00:05:00Z"))).toBe(0);
    expect(await listSprints()).toEqual([]);
  });

  it("按「做了」：打勾、記日誌，原訊息換成最新的", async () => {
    const { handleCallback } = await import("@/lib/tgFlow");
    seed();
    await handleCallback(cb(`sp:d:a:${id(2)}`));
    expect(tables.project_milestones.find((m) => m.id === id(2))!.done).toBe(true);
    expect(tables.project_logs.at(-1)).toMatchObject({ project_id: FIT_ID, text: "完成待辦：拍影片", source: "telegram" });
    expect(sent.map((s) => s.method)).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect(sent[1].body.text).toContain("待辦完成 2／6");
    expect(sent[1].body.text).not.toContain("拍影片");
    // 再按一次不會重複記
    await handleCallback(cb(`sp:d:a:${id(2)}`));
    expect(tables.project_logs).toHaveLength(1);
  });

  it("按「已經完成」或回「衝刺 取消」：停止提醒；指令可以重新開始", async () => {
    const { handleCallback } = await import("@/lib/tgFlow");
    const { runSprint, listSprints } = await import("@/lib/sprint");
    const { handleProjectText } = await import("@/lib/projects");
    seed();
    await handleCallback(cb(`sp:e:${FIT_ID}`));
    expect(await listSprints()).toEqual([]);
    expect(sent.at(-1)!.body.text).toContain("每天提醒停了");
    expect(await runSprint(MORNING)).toBe(0);

    expect(await handleProjectText("fit 衝刺 11/30 12:00 報名截止")).toContain("開始衝刺");
    expect(await listSprints()).toEqual([SPRINT]);
    expect(await handleProjectText("fit 衝刺 取消")).toContain("提醒停了");
    expect(await handleProjectText("fit 衝刺 取消")).toContain("本來就沒有");
  });

  it("衝刺中的專案，每晚進度確認不重複問", async () => {
    const { runCheckin } = await import("@/lib/checkin");
    seed();
    expect(await runCheckin(NIGHT)).toBe(1);
    expect(messages()[0].body.text).toContain("別的專案的事");
  });
});
