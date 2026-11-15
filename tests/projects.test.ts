// 專案管理：階段、里程碑提醒、久沒動、Telegram 文字指令、每日 08:00 總覽
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import { buildDigest, cleanLinks, cleanStages, isStale, milestoneReminder, parseDue, parseProjectCommand, parseRange, type Milestone, type Project } from "@/lib/projectLogic";

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

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-02T00:00:00Z"); // 台北 11/2 08:00
const TODAY = "2026-11-02";
const FIT_ID = "11111111-1111-1111-1111-111111111111";
const CAFE_ID = "22222222-2222-2222-2222-222222222222";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發", "封測", "上架審核"], stage: 2, next_step: "整理回報",
  status: "active", folder: "Fit", repo: null, sort: 10, last_activity_at: new Date(NOW).toISOString(), stale_asked_at: null, ...over,
});
const ms = (over: Partial<Milestone> = {}): Milestone => ({ id: "m1", project_id: FIT_ID, title: "正式上架", due: "2026-11-09", done: false, reminded_7: false, reminded_1: false, ...over });

describe("專案規則", () => {
  it("階段整理：多種分隔符號、去重、去空白", () => {
    expect(cleanStages("構想、開發, 封測，上線\n上線\n  ")).toEqual(["構想", "開發", "封測", "上線"]);
    expect(cleanStages("A → B → C")).toEqual(["A", "B", "C"]);
  });
  it("日期：月日今天以前算明年、完整日期、錯的日期", () => {
    expect(parseDue("12/1", TODAY)).toBe("2026-12-01");
    expect(parseDue("1/5", TODAY)).toBe("2027-01-05");
    expect(parseDue("2026/11/2", TODAY)).toBe("2026-11-02");
    expect(parseDue("2/30", TODAY)).toBeNull();
    expect(parseDue("明天", TODAY)).toBeNull();
  });
  it("連結：補 https、拿掉空的、標出不是網址的", () => {
    expect(cleanLinks({ website: "fit.app", instagram: " https://instagram.com/fit ", threads: "", line: "不是網址", youtube: "javascript:alert(1)" })).toEqual({
      links: { website: "https://fit.app/", instagram: "https://instagram.com/fit" },
      bad: ["line", "youtube"],
    });
  });
  it("排程日期：區間、只寫結束日、跨年、單日、60 天內的過去算今年", () => {
    expect(parseRange("11/20-11/25", TODAY)).toEqual({ start: "2026-11-20", end: "2026-11-25" });
    expect(parseRange("11/20～25", TODAY)).toEqual({ start: "2026-11-20", end: "2026-11-25" });
    expect(parseRange("12/28 到 1/3", TODAY)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(parseRange("12/1", TODAY)).toEqual({ start: "2026-12-01", end: "2026-12-01" });
    expect(parseRange("10/20", TODAY)).toEqual({ start: "2026-10-20", end: "2026-10-20" });
    expect(parseRange("1/5", TODAY)).toEqual({ start: "2027-01-05", end: "2027-01-05" });
    expect(parseRange("2026/12/1-2026/12/3", TODAY)).toEqual({ start: "2026-12-01", end: "2026-12-03" });
    expect(parseRange("11/25-11/20", TODAY)).toBeNull(); // 多半是打錯，不當成一整年
  });
  it("里程碑提醒：前 7 天一次、前 1 天一次、過期與完成不提醒", () => {
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-10" }))).toBeNull();
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-09" }))).toBe("7");
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-09", reminded_7: true }))).toBeNull();
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-03", reminded_7: true }))).toBe("1");
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-02" }))).toBe("1");
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-01" }))).toBeNull();
    expect(milestoneReminder(TODAY, ms({ due: "2026-11-05", done: true }))).toBeNull();
  });
  it("久沒動：5 天、只問一次直到再過 5 天、暫停的不問", () => {
    const old = new Date(NOW - 6 * DAY).toISOString();
    expect(isStale(proj({ last_activity_at: new Date(NOW - 4 * DAY).toISOString() }), NOW)).toBe(false);
    expect(isStale(proj({ last_activity_at: old }), NOW)).toBe(true);
    expect(isStale(proj({ last_activity_at: old, stale_asked_at: new Date(NOW - 2 * DAY).toISOString() }), NOW)).toBe(false);
    expect(isStale(proj({ last_activity_at: old, stale_asked_at: new Date(NOW - 5 * DAY).toISOString() }), NOW)).toBe(true);
    expect(isStale(proj({ last_activity_at: old, status: "paused" }), NOW)).toBe(false);
  });
  it("文字指令：專案名不分大小寫；不是指令就回 null", () => {
    const ps = [proj(), proj({ id: CAFE_ID, slug: "cafe", name: "Cafe", stages: ["開發", "上線前準備"], stage: 1 })];
    expect(parseProjectCommand("Fit 下一步 做好友動態", ps, TODAY)).toMatchObject({ action: "next", value: "做好友動態" });
    expect(parseProjectCommand("fit 下一階段", ps, TODAY)).toMatchObject({ action: "stage", value: 3 });
    expect(parseProjectCommand("fit 階段 開發", ps, TODAY)).toMatchObject({ action: "stage", value: 1 });
    expect(parseProjectCommand("fit 階段 4", ps, TODAY)).toMatchObject({ action: "stage", value: 3 });
    expect(parseProjectCommand("fit 階段 不存在", ps, TODAY)).toMatchObject({ action: "error" });
    expect(parseProjectCommand("cafe 下一階段", ps, TODAY)).toMatchObject({ action: "error" });
    expect(parseProjectCommand("fit 里程碑 12/1 正式上架", ps, TODAY)).toMatchObject({ action: "milestone", value: "正式上架", due: "2026-12-01" });
    expect(parseProjectCommand("fit 記錄：修好地圖", ps, TODAY)).toMatchObject({ action: "log", value: "修好地圖" });
    expect(parseProjectCommand("fit 排程 11/20-11/25 封測第二輪", ps, TODAY)).toMatchObject({ action: "event", value: "封測第二輪", start: "2026-11-20", end: "2026-11-25" });
    expect(parseProjectCommand("fit 排程 12/1 送審", ps, TODAY)).toMatchObject({ action: "event", value: "送審", start: "2026-12-01", end: "2026-12-01" });
    expect(parseProjectCommand("fit 排程 下週 送審", ps, TODAY)).toMatchObject({ action: "error" });
    expect(parseProjectCommand("fit 下一階段很重要的功能", ps, TODAY)).toBeNull(); // 指令後面沒有空白：這句是點子
    expect(parseProjectCommand("fit 的好友動態可以做排行榜", ps, TODAY)).toBeNull();
    expect(parseProjectCommand("oldnotes 下一步 部署", ps, TODAY)).toBeNull();
  });
  it("早上總覽：里程碑提醒在最上面、列出階段與下一步、久沒動的問一聲", () => {
    const ps = [proj(), proj({ id: CAFE_ID, slug: "cafe", name: "Cafe", stages: ["開發", "上線前準備"], stage: 1, next_step: null, last_activity_at: new Date(NOW - 7 * DAY).toISOString() })];
    const d = buildDigest(ps, [ms(), ms({ id: "m2", due: "2026-11-03", title: "送審" })], TODAY, NOW, "https://x.app");
    expect(d.remind7).toEqual(["m1"]);
    expect(d.remind1).toEqual(["m2"]);
    expect(d.staleAsked).toEqual([CAFE_ID]);
    expect(d.html.indexOf("里程碑提醒")).toBeLessThan(d.html.indexOf("<b>Fit</b>"));
    expect(d.html).toContain("🔴 Fit｜送審（11/03，明天）");
    expect(d.html).toContain("<b>Fit</b>・封測（3/4）");
    expect(d.html).toContain("👉 還沒寫下一步");
    expect(d.html).toContain("Cafe 已經 7 天沒更新");
    expect(d.html).toContain("https://x.app/projects");
  });
});

// ---------- 伺服器流程 ----------

let sent: Array<{ method: string; body: any }> = [];
beforeEach(() => {
  reset();
  sent = [];
  pending.length = 0;
  tables.projects.push(
    { ...proj(), last_activity_at: new Date(Date.now() - 6 * DAY).toISOString() },
    // 最後活動用「現在」而不是固定的 NOW，不然過幾天跑測試 Cafe 也會變成久沒動
    { ...proj({ id: CAFE_ID, slug: "cafe", name: "Cafe", stages: ["開發", "上線前準備", "宣傳上線"], stage: 1 }), sort: 20, last_activity_at: new Date().toISOString() },
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      sent.push({ method: u.split("/").pop()!, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return Response.json({ ok: true, result: { message_id: 500 } });
    }
    throw new Error("unexpected fetch " + u);
  });
});

async function post(text: string) {
  const { POST } = await import("@/app/api/telegram/route");
  const req = new Request("https://x/api/telegram", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "s3cret", "content-type": "application/json" },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: 111, type: "private" }, from: { id: 111 }, text } }),
  });
  await POST(req as any);
  await Promise.all(pending);
}
const lastReply = () => sent.filter((s) => s.method === "sendMessage").at(-1)!.body.text as string;

describe("Telegram 更新專案", () => {
  it("下一步、下一階段、記錄、里程碑都會寫進去並記日誌；不會被存成點子", async () => {
    await post("fit 下一步 做好友動態");
    expect(tables.projects[0].next_step).toBe("做好友動態");
    expect(lastReply()).toContain("Fit 的下一步：做好友動態");
    await post("fit 下一階段");
    expect(tables.projects[0].stage).toBe(3);
    expect(lastReply()).toContain("上架審核");
    await post("fit 記錄 修好地圖");
    await post("fit 里程碑 12/1 正式上架");
    expect(tables.project_milestones[0]).toMatchObject({ project_id: FIT_ID, title: "正式上架" });
    expect(tables.project_logs.map((l) => l.text)).toEqual(["下一步：做好友動態", "階段：封測 → 上架審核", "修好地圖", "新增里程碑：正式上架（2026-12-01）"]);
    expect(tables.project_logs.every((l) => l.source === "telegram")).toBe(true);
    // 有動作就不算久沒動
    expect(Date.now() - Date.parse(tables.projects[0].last_activity_at)).toBeLessThan(5000);
    await post("fit 排程 11/20-11/25 封測第二輪");
    expect(tables.project_events[0]).toMatchObject({ project_id: FIT_ID, title: "封測第二輪", start_date: "2026-11-20", end_date: "2026-11-25", source: "telegram" });
    expect(lastReply()).toContain("新增排程：封測第二輪（11/20～11/25）");
    await post("fit 排程 11/20-11/25 封測第二輪");
    expect(tables.project_events).toHaveLength(1);
    expect(tables.ideas).toHaveLength(0);
  });
  it("「cafe 下一步」是專案指令，不會被當成點子或其他存放地點", async () => {
    await post("cafe 下一步 申請 LINE 官方帳號");
    expect(tables.projects[1].next_step).toBe("申請 LINE 官方帳號");
    expect(tables.ideas).toHaveLength(0);
  });
  it("「專案」回覆總覽但不標記提醒", async () => {
    await post("專案");
    expect(lastReply()).toContain("📋 <b>專案進度</b>");
    expect(tables.projects[0].stale_asked_at).toBeNull();
  });
});

describe("每日 08:00", () => {
  it("傳一則總覽，標記已提醒的里程碑與已問過的久沒動專案；第二次不重複提醒", async () => {
    const { runProjectTick } = await import("@/lib/projects");
    const { taipeiDate } = await import("@/lib/dates");
    const in3 = taipeiDate(new Date(Date.now() + 3 * DAY));
    tables.project_milestones.push({ ...ms({ id: "m9", due: in3 }) });
    const r = await runProjectTick();
    expect(r).toMatchObject({ sent: true, reminded: 1, stale: 1 });
    expect(sent.filter((s) => s.method === "sendMessage")).toHaveLength(1);
    expect(tables.project_milestones[0].reminded_7).toBe(true);
    expect(tables.projects[0].stale_asked_at).not.toBeNull();
    const again = await runProjectTick();
    expect(again).toMatchObject({ reminded: 0, stale: 0 });
  });
  it("網頁：改階段名稱時停在同名階段；短名不能重複", async () => {
    const a = await import("@/app/(dash)/projects/actions");
    const r = await a.saveProjectSettings(FIT_ID, { name: "Fit", slug: "fit", stages: "開發、封測、上架審核", folder: "Fit", repo: "https://github.com/me/fit.git", status: "active" });
    expect(r.ok).toBe(true);
    expect(tables.projects[0]).toMatchObject({ stages: ["開發", "封測", "上架審核"], stage: 1, repo: "me/fit" });
    expect((await a.saveProjectSettings(FIT_ID, { name: "Fit", slug: "cafe", stages: "a", folder: "", repo: "", status: "active" })).ok).toBe(false);
    expect((await a.setStage(FIT_ID, 9)).ok).toBe(false);
    expect((await a.createProject("Oldnotes", "")).ok).toBe(true);
    expect(tables.projects.at(-1)).toMatchObject({ slug: "oldnotes", stages: ["構想", "開發", "上線", "維運"] });
  });
});
