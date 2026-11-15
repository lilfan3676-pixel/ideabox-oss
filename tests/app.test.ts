// 手機 App：配對、裝置驗證、推送、有時間的排程提醒、給 App 的資料
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import { dueReminders, normalizePairCode, parseTime, parseUiTheme, plainText, sha256, taipeiEpoch, todayEventsPush, uiThemeValue } from "@/lib/appLogic";
import { parseProjectCommand, type Project } from "@/lib/projectLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_OWNER_ID = "111";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-11-20T05:40:00Z"); // 台北 11/20 13:40

type PushCall = { to: string; title: string; body: string };
let pushes: PushCall[] = [];
let telegram: string[] = [];
let expoReply: (msgs: PushCall[]) => unknown = (msgs) => ({ data: msgs.map(() => ({ status: "ok", id: "x" })) });

beforeEach(() => {
  reset();
  pushes = [];
  telegram = [];
  expoReply = (msgs) => ({ data: msgs.map(() => ({ status: "ok", id: "x" })) });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "https://exp.host/--/api/v2/push/send") {
      const msgs = JSON.parse(String(init?.body)) as PushCall[];
      pushes.push(...msgs);
      return Response.json(expoReply(msgs));
    }
    if (u.includes("api.telegram.org")) {
      telegram.push(String(JSON.parse(String(init?.body ?? "{}")).text ?? ""));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }
    throw new Error(`沒預期的請求 ${u}`);
  });
  tables.projects.push({ id: FIT_ID, slug: "fit", name: "Fit", stages: ["開發", "封測"], stage: 1, next_step: "整理回報", status: "active", sort: 10, last_activity_at: new Date(NOW).toISOString(), stale_asked_at: null });
});

describe("純邏輯", () => {
  it("時間格式：接受 9:05、14：00、14:00:00，拒絕 24:00", () => {
    expect(parseTime("9:5")).toBe("09:05");
    expect(parseTime("14：00")).toBe("14:00");
    expect(parseTime("14:00:00")).toBe("14:00");
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("明天")).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });

  it("配對碼：去掉空白、連字號並轉大寫", () => {
    expect(normalizePairCode(" abcd-ef 23 ")).toBe("ABCDEF23");
    expect(normalizePairCode(123)).toBe("");
  });

  it("台北時間換算（+08:00）", () => {
    expect(taipeiEpoch("2026-11-20", "14:00")).toBe(Date.parse("2026-11-20T06:00:00Z"));
  });

  it("開始前 30 分鐘內才推；推過的、太久以前的、沒時間的都不推", () => {
    const base = { title: "開會", start_date: "2026-11-20", reminded: false };
    const list = [
      { ...base, id: "a", start_time: "14:00:00" }, // 20 分鐘後 → 推
      { ...base, id: "b", start_time: "14:30:00" }, // 50 分鐘後 → 還沒
      { ...base, id: "c", start_time: "13:35:00" }, // 5 分鐘前開始 → 補推
      { ...base, id: "d", start_time: "13:00:00" }, // 40 分鐘前 → 太舊
      { ...base, id: "e", start_time: "14:00:00", reminded: true },
      { ...base, id: "f", start_time: null },
    ];
    expect(dueReminders(list, NOW).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("今天的排程：照時間排、多天的只在第一天提", () => {
    const msg = todayEventsPush(
      [
        { title: "送審", start_date: "2026-11-20", end_date: "2026-11-20", start_time: null, project_name: "Fit" },
        { title: "開會", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "09:30:00", project_name: "Fit" },
        { title: "封測", start_date: "2026-11-20", end_date: "2026-11-25", start_time: null },
        { title: "昨天開始的", start_date: "2026-11-19", end_date: "2026-11-22", start_time: null },
      ],
      "2026-11-20",
    )!;
    expect(msg.title).toBe("🗓 今天有 3 個排程");
    expect(msg.body.split("\n")).toEqual(["09:30 ［Fit］開會", "［Fit］送審", "封測（到 11/25）"]);
    expect(todayEventsPush([], "2026-11-20")).toBeNull();
  });

  it("推送文字拿掉 Telegram 的 HTML", () => {
    expect(plainText("🔴 <b>Fit</b> 連不上&lt;502&gt; &amp; 重試")).toBe("🔴 Fit 連不上<502> & 重試");
  });

  it("Telegram「排程 12/1 14:00 開會」會帶時間，沒寫時間照舊", () => {
    const p = tables.projects[0] as Project;
    const withTime = parseProjectCommand("fit 排程 12/1 14:00 跟投資人開會", [p], "2026-11-20");
    expect(withTime).toMatchObject({ action: "event", value: "跟投資人開會", start: "2026-12-01", end: "2026-12-01", time: "14:00" });
    const noTime = parseProjectCommand("fit 排程 11/20-11/25 封測第二輪", [p], "2026-11-20");
    expect(noTime).toMatchObject({ action: "event", value: "封測第二輪", start: "2026-11-20", end: "2026-11-25", time: null });
    // 標題本身是數字開頭但不是時間，不能被吃掉
    expect(parseProjectCommand("fit 排程 12/1 3 位使用者訪談", [p], "2026-11-20")).toMatchObject({ value: "3 位使用者訪談", time: null });
  });
});

describe("配對與驗證", () => {
  it("配對碼只能用一次，拿到的憑證可以通過驗證、資料庫只存雜湊", async () => {
    const { createPairCode, redeemPairCode, deviceFromRequest } = await import("@/lib/app");
    const { code } = await createPairCode(NOW);
    const r = await redeemPairCode(code.toLowerCase(), "Fan 的 iPhone", NOW + 60_000);
    expect(r).not.toBeNull();
    expect(tables.app_devices).toHaveLength(1);
    expect(tables.app_devices[0].name).toBe("Fan 的 iPhone");
    expect(tables.app_devices[0].token_hash).toBe(sha256(r!.token));
    expect(JSON.stringify(tables.app_devices)).not.toContain(r!.token);
    // 同一組碼第二次就失效
    expect(await redeemPairCode(code, "另一台", NOW + 61_000)).toBeNull();

    const ok = await deviceFromRequest(new Request("https://x/api/app/home", { headers: { Authorization: `Bearer ${r!.token}` } }));
    expect(ok?.id).toBe(r!.deviceId);
    expect(await deviceFromRequest(new Request("https://x/api/app/home", { headers: { Authorization: "Bearer wrong-token-wrong-token-xx" } }))).toBeNull();
    expect(await deviceFromRequest(new Request("https://x/api/app/home"))).toBeNull();
  });

  it("配對碼 10 分鐘後失效、打錯也不行", async () => {
    const { createPairCode, redeemPairCode } = await import("@/lib/app");
    const { code } = await createPairCode(NOW);
    expect(await redeemPairCode("WRONGCODE", "x", NOW)).toBeNull();
    expect(await redeemPairCode(code, "x", NOW + 11 * 60_000)).toBeNull();
    expect(tables.app_devices).toHaveLength(0);
  });

  it("API：沒配對回 401；解除配對後同一個憑證就不能用", async () => {
    const { createPairCode, redeemPairCode } = await import("@/lib/app");
    const home = await import("@/app/api/app/home/route");
    const device = await import("@/app/api/app/device/route");
    expect((await home.GET(new Request("https://x/api/app/home"))).status).toBe(401);
    const { code } = await createPairCode();
    const { token } = (await redeemPairCode(code, "iPhone"))!;
    const auth = { Authorization: `Bearer ${token}` };
    const res = await home.GET(new Request("https://x/api/app/home", { headers: auth }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects[0]).toMatchObject({ slug: "fit", stage: "封測" });

    // 推送地址格式不對就拒絕
    expect((await device.POST(new Request("https://x", { method: "POST", headers: auth, body: JSON.stringify({ push_token: "abc" }) }))).status).toBe(400);
    expect((await device.POST(new Request("https://x", { method: "POST", headers: auth, body: JSON.stringify({ push_token: "ExponentPushToken[abc123]" }) }))).status).toBe(200);
    expect(tables.app_devices[0].push_token).toBe("ExponentPushToken[abc123]");

    expect((await device.DELETE(new Request("https://x", { method: "DELETE", headers: auth }))).status).toBe(200);
    expect((await home.GET(new Request("https://x/api/app/home", { headers: auth }))).status).toBe(401);
  });

  it("配對 API：錯的碼回 400", async () => {
    const pair = await import("@/app/api/app/pair/route");
    const res = await pair.POST(new Request("https://x/api/app/pair", { method: "POST", body: JSON.stringify({ code: "NOPE1234" }) }));
    expect(res.status).toBe(400);
  });
});

describe("推送", () => {
  it("沒有配對手機就不送；有就送到每台開了通知的手機", async () => {
    const { sendPush } = await import("@/lib/app");
    expect(await sendPush({ title: "t", body: "b" })).toBe(0);
    expect(pushes).toHaveLength(0);
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    tables.app_devices.push({ id: "d2", name: "b", token_hash: "h2", push_token: null, last_seen_at: new Date().toISOString() });
    expect(await sendPush({ title: "t", body: "b" })).toBe(1);
    expect(pushes.map((p) => p.to)).toEqual(["ExponentPushToken[1]"]);
  });

  it("App 被刪掉（DeviceNotRegistered）就清掉推送地址", async () => {
    const { sendPush } = await import("@/lib/app");
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    expoReply = () => ({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
    expect(await sendPush({ title: "t", body: "b" })).toBe(0);
    expect(tables.app_devices[0].push_token).toBeNull();
  });

  it("推送服務掛掉不會讓排程出錯", async () => {
    const { sendPushSafe } = await import("@/lib/app");
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    expect(await sendPushSafe({ title: "t", body: "b" })).toBe(0);
  });

  it("有時間的排程：開始前 30 分鐘推一次，不重複推", async () => {
    const { runEventReminders } = await import("@/lib/app");
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    tables.project_events.push(
      { id: "e1", project_id: FIT_ID, title: "跟投資人開會", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "14:00:00", reminded: false },
      { id: "e2", project_id: FIT_ID, title: "晚上的事", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "20:00:00", reminded: false },
      { id: "e3", project_id: FIT_ID, title: "沒時間", start_date: "2026-11-20", end_date: "2026-11-20", start_time: null, reminded: false },
    );
    expect(await runEventReminders(NOW)).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "⏰ 14:00 跟投資人開會", body: "Fit・30 分鐘後開始" });
    expect(tables.project_events.find((e) => e.id === "e1")!.reminded).toBe(true);
    expect(await runEventReminders(NOW + 5 * 60_000)).toBe(0);
    expect(pushes).toHaveLength(1);
  });

  it("每日 08:00：Telegram 照舊，手機另外收到今天排程與里程碑提醒", async () => {
    const { runProjectTick } = await import("@/lib/projects");
    const morning = Date.parse("2026-11-20T00:00:00Z"); // 台北 08:00
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    tables.project_events.push({ id: "e1", project_id: FIT_ID, title: "開會", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "14:00:00", reminded: false });
    tables.project_milestones.push({ id: "m1", project_id: FIT_ID, title: "正式上架", due: "2026-11-21", done: false, reminded_7: true, reminded_1: false });
    const r = await runProjectTick(morning);
    expect(r.sent).toBe(true);
    expect(telegram.join("")).toContain("正式上架");
    expect(pushes.map((p) => p.title)).toEqual(["🗓 今天有 1 個排程", "📅 明天：正式上架"]);
    expect(pushes[0].body).toBe("14:00 ［Fit］開會");
  });

  it("產品掛掉時手機也收到推送", async () => {
    const { runMonitor } = await import("@/lib/monitor");
    tables.app_devices.push({ id: "d1", name: "a", token_hash: "h1", push_token: "ExponentPushToken[1]", last_seen_at: new Date().toISOString() });
    // 網址監控：官網回 500
    tables.settings.push({ key: "monitor_sites", value: JSON.stringify([{ id: "a1", name: "官網", url: "https://site.test" }]), updated_at: new Date().toISOString() });
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://exp.host") || u.includes("api.telegram.org")) return base(url, init);
      if (u.startsWith("https://site.test")) return new Response("", { status: 500 });
      if (u.includes("webhook")) return new Response("", { status: 401 });
      return new Response("ok", { status: 200 });
    });
    // 連續失敗才算掛掉：跑到發出通知為止
    for (let i = 0; i < 5 && !pushes.length; i++) await runMonitor({ notify: true });
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.find((p) => p.title.includes("官網"))?.title).toBe("🔴 官網・網站 連不上");
  });
});

describe("給 App 的資料", () => {
  it("首頁：只給接下來 14 天的排程與 30 天內的里程碑，時間只到分鐘", async () => {
    const { homeData } = await import("@/lib/app");
    tables.project_events.push(
      { id: "e1", project_id: FIT_ID, title: "今天", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "14:00:00" },
      { id: "e2", project_id: FIT_ID, title: "很久以後", start_date: "2027-01-20", end_date: "2027-01-20", start_time: null },
      { id: "e3", project_id: FIT_ID, title: "進行中", start_date: "2026-11-18", end_date: "2026-11-22", start_time: null },
    );
    tables.project_milestones.push(
      { id: "m1", project_id: FIT_ID, title: "上架", due: "2026-12-01", done: false },
      { id: "m2", project_id: FIT_ID, title: "完成的", due: "2026-12-01", done: true },
    );
    const d = await homeData(NOW);
    expect(d.today).toBe("2026-11-20");
    expect(d.events.map((e) => e.title).sort()).toEqual(["今天", "進行中"]);
    expect(d.events.find((e) => e.id === "e1")!.start_time).toBe("14:00");
    expect(d.milestones.map((m) => m.title)).toEqual(["上架"]);
  });

  it("月曆：月底算得對（11 月只到 30 日）", async () => {
    const { calendarData } = await import("@/lib/app");
    tables.project_events.push(
      { id: "e1", project_id: FIT_ID, title: "月底", start_date: "2026-11-30", end_date: "2026-11-30" },
      { id: "e2", project_id: FIT_ID, title: "下個月", start_date: "2026-12-01", end_date: "2026-12-01" },
    );
    const d = await calendarData("2026-11");
    expect(d.events.map((e) => e.title)).toEqual(["月底"]);
  });

  it("首頁帶網頁目前的主題；沒存過用 fluento 淺色", async () => {
    const { homeData } = await import("@/lib/app");
    expect((await homeData(NOW)).theme).toEqual({ theme: "fluento", mode: "light" });
    tables.settings.push({ key: "ui_theme", value: "portal:dark" });
    expect((await homeData(NOW)).theme).toEqual({ theme: "portal", mode: "dark" });
  });

  it("辦公室：同專案同職位算同一個人，沒填資料夾的專案沒有房間、人放大廳", async () => {
    const { officeData } = await import("@/lib/app");
    const iso = (min: number) => new Date(NOW - min * 60_000).toISOString();
    tables.agent_sessions.push(
      { session_id: "a", project_id: FIT_ID, folder: "Fit", role: "前端工程師", task: "修地圖", status: "working", started_at: iso(20), updated_at: iso(1), ended_at: null },
      { session_id: "b", project_id: FIT_ID, folder: "Fit", role: "前端工程師", task: "舊的", status: "idle", started_at: iso(30), updated_at: iso(5), ended_at: null },
      { session_id: "c", project_id: null, folder: "tmp", role: "研究員", task: "查資料", status: "ended", started_at: iso(90), updated_at: iso(60), ended_at: iso(60) },
    );
    expect((await officeData(NOW)).rooms.map((r) => r.id)).toEqual(["lobby"]); // Fit 還沒填資料夾：人都在大廳
    tables.projects[0].folder = "Fit";
    const d = await officeData(NOW);
    const people = d.people;
    expect(d.rooms.map((r) => r.id)).toEqual([FIT_ID, "lobby"]);
    expect(people.filter((p) => p.room === FIT_ID)).toEqual([expect.objectContaining({ role: "前端工程師", status: "working", task: "修地圖", sessions: 2 })]);
    expect(people.find((p) => p.room === "lobby")).toMatchObject({ role: "研究員", status: "ended", task: null });
    expect(d.rooms.at(-1)!.id).toBe("lobby");
  });
});

describe("主題同步", () => {
  it("只接受三種主題與淺色／深色", () => {
    expect(uiThemeValue("ember", "dark")).toBe("ember:dark");
    expect(uiThemeValue("hack", "dark")).toBeNull();
    expect(uiThemeValue("portal", "dim")).toBeNull();
    expect(parseUiTheme("ember:dark")).toEqual({ theme: "ember", mode: "dark" });
    expect(parseUiTheme(null)).toEqual({ theme: "fluento", mode: "light" });
    expect(parseUiTheme("??")).toEqual({ theme: "fluento", mode: "light" });
  });
});
