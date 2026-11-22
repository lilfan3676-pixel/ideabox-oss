import "server-only";
// 手機 App：配對、裝置驗證、推送通知、給 App 看的資料
import { db } from "./db";
import { taipeiDate } from "./dates";
import { listProjects } from "./projects";
import { listOffice } from "./office";
import { displayStatus, handoffLive, staffKey, staffOf } from "./officeLogic";
import { CATEGORY_LABEL, type Category } from "./labels";
import {
  dueReminders,
  newDeviceToken,
  newPairCode,
  normalizePairCode,
  PAIR_TTL_MS,
  parseUiTheme,
  sha256,
  todayEventsPush,
  type PushMessage,
  type TimedEvent,
} from "./appLogic";
import { accessOf, appTabs, can, filterByProject, memberGetsPush, productsFor, seesProject, type Access, type Member, type PageKey, type PushScope } from "./accessLogic";
import { getMember, listMembers } from "./members";

export type AppDevice = { id: string; name: string; push_token: string | null; created_at: string; last_seen_at: string; member_id?: string | null };

const PAIR_KEY = "app_pair";

// ---------- 配對 ----------

/** 產生一組新的配對碼（10 分鐘內有效、用一次就失效；舊的那組直接作廢） */
export async function createPairCode(now = Date.now(), memberId: string | null = null): Promise<{ code: string; expiresAt: number }> {
  const code = newPairCode();
  const expiresAt = now + PAIR_TTL_MS;
  // memberId：替合夥人產生的配對碼，配好的手機只看得到他有權限的東西。每個人各一組，不會互相蓋掉
  const key = memberId ? `${PAIR_KEY}:${memberId}` : PAIR_KEY;
  const { error } = await db().from("settings").upsert({ key, value: JSON.stringify({ hash: sha256(code), exp: expiresAt, member: memberId }), updated_at: new Date(now).toISOString() });
  if (error) throw error;
  return { code, expiresAt };
}

/** App 送來配對碼：對了就建立裝置，回傳登入憑證（只有這一次看得到原文） */
export async function redeemPairCode(raw: unknown, name: unknown, now = Date.now()): Promise<{ token: string; deviceId: string; memberId: string | null } | null> {
  const code = normalizePairCode(raw);
  if (code.length < 6) return null;
  // 你的配對碼在 app_pair，合夥人的在 app_pair:<合夥人 id>
  const { data } = await db().from("settings").select("key, value").like("key", `${PAIR_KEY}%`);
  const hash = sha256(code);
  let saved: { hash?: string; exp?: number; member?: string | null } = {};
  let hitKey: string | null = null;
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    try {
      const v = JSON.parse(row.value) as typeof saved;
      if (v.hash === hash) {
        saved = v;
        hitKey = row.key;
        break;
      }
    } catch {
      /* 壞掉的略過 */
    }
  }
  if (!hitKey || !saved.exp || saved.exp < now) return null;
  // 先作廢配對碼，同一組碼不能配兩台
  await db().from("settings").delete().eq("key", hitKey);
  const token = newDeviceToken();
  const deviceName = typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "手機";
  const { data: row, error } = await db()
    .from("app_devices")
    .insert(saved.member ? { name: deviceName, token_hash: sha256(token), member_id: saved.member } : { name: deviceName, token_hash: sha256(token) })
    .select("id")
    .single();
  if (error || !row) throw error ?? new Error("建立裝置失敗");
  return { token, deviceId: (row as { id: string }).id, memberId: saved.member ?? null };
}

/** 從請求的 Authorization: Bearer 找出是哪台手機；沒配對或被解除就回傳 null */
export async function deviceFromRequest(req: Request): Promise<AppDevice | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S{20,})$/);
  if (!m) return null;
  // select *：還沒執行 migration-026（沒有 member_id）也能用
  const { data } = await db().from("app_devices").select("*").eq("token_hash", sha256(m[1])).maybeSingle();
  if (!data) return null;
  const d = data as AppDevice;
  // 最後使用時間：超過 5 分鐘才更新，避免每次請求都寫資料庫
  if (Date.now() - new Date(d.last_seen_at).getTime() > 5 * 60_000) {
    await db().from("app_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", d.id);
  }
  return { id: d.id, name: d.name, push_token: d.push_token, created_at: d.created_at, last_seen_at: d.last_seen_at, member_id: d.member_id ?? null };
}

/** 這台手機能看什麼：你的手機＝全部；合夥人的手機照他的權限，被停用或刪掉回傳 null（App 會回到配對畫面） */
export async function deviceAccess(d: AppDevice): Promise<Access | null> {
  if (!d.member_id) return { owner: true };
  const m = await getMember(d.member_id);
  if (!m || !m.active) return null;
  return accessOf(m);
}

export async function listDevices(): Promise<{ devices: AppDevice[]; ready: boolean }> {
  const { data, error } = await db().from("app_devices").select("*").order("created_at", { ascending: false });
  if (error) return { devices: [], ready: false };
  return { devices: ((data ?? []) as AppDevice[]).map((d) => ({ ...d, member_id: d.member_id ?? null })), ready: true };
}

export async function removeDevice(id: string): Promise<void> {
  await db().from("app_devices").delete().eq("id", id);
}

export async function savePushToken(deviceId: string, token: unknown): Promise<boolean> {
  if (token !== null && (typeof token !== "string" || !/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token))) return false;
  await db().from("app_devices").update({ push_token: token }).eq("id", deviceId);
  return true;
}

// ---------- 推送 ----------

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** 推送到開了通知的手機：你的手機全部都收；合夥人的手機只收 scope 裡他看得到的專案（沒有 scope＝只給你）。
 *  onlyMember：只推給這位合夥人（早上的今日排程，每個人內容不同）。
 *  沒有配對任何手機、或還沒執行 migration-022 就什麼都不做。回傳送出幾台 */
export async function sendPush(msg: PushMessage, scope?: PushScope, onlyMember?: string): Promise<number> {
  const { data, error } = await db().from("app_devices").select("*").not("push_token", "is", null);
  if (error || !data?.length) return 0;
  const all = (data as { id: string; push_token: string | null; member_id?: string | null }[]).filter((r) => r.push_token);
  let rows = all.filter((r) => !r.member_id);
  if (onlyMember) rows = all.filter((r) => r.member_id === onlyMember);
  else if (scope && all.some((r) => r.member_id)) {
    // 一次查完所有合夥人，再挑出這則該收的
    const { members } = await listMembers();
    const gets = new Set(members.filter((m) => memberGetsPush(m, scope)).map((m) => m.id));
    rows = all.filter((r) => !r.member_id || gets.has(r.member_id));
  }
  if (!rows.length) return 0;
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(
      rows.map((r) => ({ to: r.push_token, title: msg.title.slice(0, 120), body: msg.body.slice(0, 900), data: msg.data ?? {}, sound: "default", priority: "high" })),
    ),
  });
  if (!res.ok) throw new Error(`Expo 推送失敗 ${res.status}`);
  const json = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
  // App 被刪掉或關掉通知：清掉推送地址，下次不再送
  const gone = (json.data ?? []).map((t, i) => (t.status === "error" && t.details?.error === "DeviceNotRegistered" ? rows[i]?.id : null)).filter(Boolean) as string[];
  if (gone.length) await db().from("app_devices").update({ push_token: null }).in("id", gone);
  return (json.data ?? []).filter((t) => t.status === "ok").length;
}

/** 推送失敗不能影響原本的 Telegram 通知與排程 */
export async function sendPushSafe(msg: PushMessage, scope?: PushScope, onlyMember?: string): Promise<number> {
  try {
    return await sendPush(msg, scope, onlyMember);
  } catch (err) {
    console.error("push", err);
    return 0;
  }
}

/** 每 5 分鐘：有填時間的排程，開始前 30 分鐘推送一次 */
export async function runEventReminders(now = Date.now()): Promise<number> {
  const today = taipeiDate(new Date(now));
  // 開始時間在明天凌晨的也要看（今天 23:50 時要提醒明天 00:10 的）
  const tomorrow = taipeiDate(new Date(now + 86_400_000));
  const { data, error } = await db()
    .from("project_events")
    .select("id, title, start_date, start_time, reminded, project_id")
    .gte("start_date", today)
    .lte("start_date", tomorrow)
    .eq("reminded", false);
  if (error || !data?.length) return 0;
  const due = dueReminders(data as (TimedEvent & { project_id: string })[], now);
  if (!due.length) return 0;
  const names = await projectNames();
  let sent = 0;
  for (const e of due) {
    // 先標記再推，推送服務掛了也不會每 5 分鐘重推一次
    await db().from("project_events").update({ reminded: true }).eq("id", e.id);
    const who = names.get(e.project_id);
    sent += await sendPushSafe({ title: `⏰ ${e.start_time!.slice(0, 5)} ${e.title}`, body: who ? `${who}・30 分鐘後開始` : "30 分鐘後開始", data: { screen: "today" } }, { projectIds: [e.project_id], pages: SCHEDULE_PAGES });
  }
  return sent;
}

/** 早上 8 點：今天開始的排程 */
export async function pushTodayEvents(now = Date.now()): Promise<number> {
  const today = taipeiDate(new Date(now));
  const { data, error } = await db().from("project_events").select("title, start_date, end_date, start_time, project_id").eq("start_date", today);
  if (error || !data?.length) return 0;
  const names = await projectNames();
  const rows = (data as { title: string; start_date: string; end_date: string; start_time?: string | null; project_id: string }[]).map((e) => ({ ...e, start_time: e.start_time ?? null, project_name: names.get(e.project_id) }));
  // 你收到全部；每位合夥人另外收到只有他專案的那一份
  const msg = todayEventsPush(rows, today);
  let sent = msg ? await sendPushSafe(msg) : 0;
  const { members } = await listMembers();
  for (const m of members) {
    const mine = rows.filter((e) => memberGetsPush(m, { projectIds: [e.project_id], pages: SCHEDULE_PAGES }));
    const mm = mine.length ? todayEventsPush(mine, today) : null;
    if (mm) sent += await sendPushSafe(mm, undefined, m.id);
  }
  return sent;
}

/** 排程類的推送：有專案或月曆權限的合夥人才收 */
export const SCHEDULE_PAGES: PageKey[] = ["projects", "calendar"];

async function projectNames(): Promise<Map<string, string>> {
  const { projects } = await listProjects();
  return new Map(projects.map((p) => [p.id, p.name]));
}

// ---------- 給 App 看的資料 ----------

type EventRow = { id: string; project_id: string; title: string; start_date: string; end_date: string; start_time?: string | null };
type MilestoneRow = { id: string; project_id: string; title: string; due: string; done: boolean };

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const eventOut = (e: EventRow) => ({ id: e.id, project_id: e.project_id, title: e.title, start_date: e.start_date, end_date: e.end_date, start_time: e.start_time ? e.start_time.slice(0, 5) : null });

/** 網頁目前選的主題（網頁切換時存進 settings.ui_theme），App 跟著換 */
export async function getUiTheme() {
  const { data } = await db().from("settings").select("value").eq("key", "ui_theme").maybeSingle();
  return parseUiTheme((data as { value: string } | null)?.value);
}

/** 首頁「今天」：今天與接下來 14 天的排程、30 天內的里程碑、產品燈號、進行中的專案 */
export async function homeData(now = Date.now(), access: Access = { owner: true }) {
  const today = taipeiDate(new Date(now));
  const until = addDays(today, 14);
  const [{ projects: all }, ev, ms, mon, theme, open] = await Promise.all([
    listProjects(),
    db().from("project_events").select("*").lte("start_date", until).gte("end_date", today).order("start_date").limit(200),
    db().from("project_milestones").select("id, project_id, title, due, done").eq("done", false).gte("due", today).lte("due", addDays(today, 30)).order("due"),
    db().from("monitor_status").select("service, product, ok, changed_at, last_error"),
    getUiTheme(),
    // 還沒做的待辦（只拿專案與日期，算每個專案幾件過期／這週到期／總共幾件；App 2.3 起用）
    db().from("project_milestones").select("project_id, due").eq("done", false).limit(2000),
  ]);
  // 監控產品的名稱（monitor.ts 也會引用這個檔案，所以用動態載入避免互相引用）
  const allProducts = await (await import("./monitor")).monitorProducts().catch(() => []);
  // 合夥人：只有他的專案；監控只在有開「產品監控」時給他專案的產品
  const projects = all.filter((p) => seesProject(access, p.id));
  const products = can(access, "monitor") ? productsFor(access, projects.map((p) => p.slug), allProducts) : [];
  const keys = new Set(products.map((p) => p.key));
  const nameOf = (product: string, service: string) => {
    const p = products.find((x) => x.key === product);
    return `${p?.label ?? product}・${p?.services.find((x) => x.id === service)?.zh ?? service}`;
  };
  const week = addDays(today, 7);
  const todo: Record<string, { open: number; late: number; week: number }> = {};
  for (const m of filterByProject(access, (open.data ?? []) as { project_id: string; due: string | null }[])) {
    const c = (todo[m.project_id] ??= { open: 0, late: 0, week: 0 });
    c.open++;
    if (m.due && m.due < today) c.late++;
    else if (m.due && m.due <= week) c.week++;
  }
  // 過期的總數只算進行中的專案（暫停、完成的不提醒）
  const overdue = projects.filter((p) => p.status === "active").reduce((n, p) => n + (todo[p.id]?.late ?? 0), 0);
  // 辦公室有幾個人在等你（導覽列的橘點用；只給主人，讀不到就當 0）
  const office_waiting = access.owner
    ? await listOffice(now)
        .then(({ sessions }) => staffOf(sessions, now).filter((s) => ["waiting", "permission"].includes(displayStatus(s, now))).length)
        .catch(() => 0)
    : 0;
  return {
    today,
    theme,
    todo,
    overdue,
    office_waiting,
    // 這支手機能看什麼（App 依這個顯示分頁；舊版 App 不認得這個欄位也沒關係）
    access: { owner: access.owner, name: access.owner ? null : access.name, tabs: appTabs(access), can_edit: access.owner || access.canEdit },
    // 全部專案（含已完成，照排序）：App 依這個順序分配顏色，畫面上自己過濾狀態
    projects: projects.map((p) => ({ id: p.id, slug: p.slug, name: p.name, status: p.status, stage: p.stages[p.stage] ?? null, stage_index: p.stage, stage_count: p.stages.length, next_step: p.next_step, last_activity_at: p.last_activity_at })),
    events: filterByProject(access, (ev.data ?? []) as EventRow[]).map(eventOut),
    milestones: filterByProject(access, (ms.data ?? []) as MilestoneRow[]),
    monitor: ((mon.data ?? []) as { service: string; product: string; ok: boolean; changed_at: string; last_error: string | null }[]).filter((s) => access.owner || keys.has(s.product)).map((s) => ({
      service: s.service,
      product: s.product,
      label: nameOf(s.product, s.service),
      ok: s.ok,
      changed_at: s.changed_at,
      error: s.ok ? null : s.last_error,
    })),
  };
}

/** 月曆：某個月（YYYY-MM）的排程與里程碑 */
export async function calendarData(month: string, access: Access = { owner: true }) {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 31).slice(0, 8) + "01", -1);
  const [{ projects: all }, ev, ms] = await Promise.all([
    listProjects(),
    db().from("project_events").select("*").lte("start_date", last).gte("end_date", first).order("start_date").limit(500),
    db().from("project_milestones").select("id, project_id, title, due, done").gte("due", first).lte("due", last).order("due"),
  ]);
  return {
    month,
    projects: all.filter((p) => seesProject(access, p.id)).map((p) => ({ id: p.id, name: p.name })),
    events: filterByProject(access, (ev.data ?? []) as EventRow[]).map(eventOut),
    milestones: filterByProject(access, (ms.data ?? []) as MilestoneRow[]),
  };
}

/** 單一專案：階段、待辦、最近 30 筆日誌、接下來的排程。milestones 只放有日期的（舊版 App 會拿日期來算），沒日期、還沒做的放 todos */
export async function projectData(slug: string, now = Date.now(), access: Access = { owner: true }) {
  const { projects } = await listProjects();
  const p = projects.find((x) => x.slug === slug);
  if (!p || !seesProject(access, p.id)) return null;
  const today = taipeiDate(new Date(now));
  const [ms, logs, ev] = await Promise.all([
    db().from("project_milestones").select("id, project_id, title, due, done").eq("project_id", p.id).order("due"),
    db().from("project_logs").select("id, at, source, text").eq("project_id", p.id).order("at", { ascending: false }).limit(30),
    db().from("project_events").select("*").eq("project_id", p.id).gte("end_date", today).order("start_date").limit(50),
  ]);
  return {
    project: { id: p.id, slug: p.slug, name: p.name, status: p.status, stages: p.stages, stage_index: p.stage, next_step: p.next_step, description: p.description ?? null, links: p.links ?? {}, last_activity_at: p.last_activity_at },
    milestones: ((ms.data ?? []) as (Omit<MilestoneRow, "due"> & { due: string | null })[]).filter((m): m is MilestoneRow => !!m.due),
    todos: ((ms.data ?? []) as { id: string; title: string; due: string | null; done: boolean }[]).filter((m) => !m.due && !m.done).map((m) => ({ id: m.id, title: m.title })),
    logs: (logs.data ?? []) as { id: number; at: string; source: string; text: string }[],
    events: ((ev.data ?? []) as EventRow[]).map(eventOut),
  };
}

/** 點子：最近 60 則分析好的（只給看，不能改） */
export async function ideasData(access: Access = { owner: true }) {
  let q = db().from("ideas").select("id, summary, category, score_total, next_step, adopted, url, created_at, project_id").eq("status", "analyzed");
  if (!access.owner) q = q.in("project_id", access.projects.length ? access.projects : ["00000000-0000-0000-0000-000000000000"]);
  const [{ projects }, { data }] = await Promise.all([listProjects(), q.order("created_at", { ascending: false }).limit(60)]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return {
    ideas: ((data ?? []) as { id: string; summary: string | null; category: Category | null; score_total: number | null; next_step: string | null; adopted: boolean; url: string | null; created_at: string; project_id?: string | null }[]).map((i) => ({
      id: i.id,
      title: i.summary ?? "",
      category: i.category ? CATEGORY_LABEL[i.category] ?? i.category : null,
      score: i.score_total,
      next_step: i.next_step,
      adopted: i.adopted,
      url: i.url,
      created_at: i.created_at,
      project: i.project_id ? names.get(i.project_id) ?? null : null,
    })),
  };
}

/** 辦公室：每個有資料夾的專案一間房間＋大廳；房間裡是「人」（同專案同職位＝同一個人），狀態已換算好 */
export async function officeData(now = Date.now()) {
  const [{ projects }, { sessions, handoffs: hs, ready }] = await Promise.all([listProjects(), listOffice(now)]);
  const rooms = projects.filter((p) => p.folder?.trim() && p.status !== "done");
  const known = new Set(rooms.map((p) => p.id));
  const people = staffOf(sessions, now).map((s) => ({
    key: s.session_id,
    room: s.project_id && known.has(s.project_id) ? s.project_id : "lobby",
    role: s.role,
    status: displayStatus(s, now),
    // 沒在工作的不顯示上次做的事（跟網頁一樣）
    task: displayStatus(s, now) === "ended" ? null : s.task,
    folder: s.folder,
    sessions: s.sessions,
    updated_at: s.updated_at,
  }));
  // 交接中：接手的人還在做（跟網頁畫連線的條件一樣），而且交的跟接的不是同一個人；App 2.4 起畫成小球滾過去
  const byId = new Map(sessions.map((x) => [x.session_id, x]));
  const seen = new Set<string>();
  const handoffs: { from: string; to: string }[] = [];
  for (const h of hs) {
    const a = byId.get(h.from);
    const b = h.to ? byId.get(h.to) : undefined;
    if (!a || !b || !handoffLive(b, now)) continue;
    const from = staffKey(a);
    const to = staffKey(b);
    if (from === to || seen.has(`${from}>${to}`)) continue;
    seen.add(`${from}>${to}`);
    handoffs.push({ from, to });
  }
  return {
    ready,
    now,
    handoffs,
    // 顏色照全部專案的順序（跟網頁、App 其他頁一致）
    projects: projects.map((p) => ({ id: p.id })),
    rooms: [...rooms.map((p) => ({ id: p.id, name: p.name, stage: p.stages[p.stage] ?? null })), { id: "lobby", name: "大廳", stage: null }],
    people,
  };
}

/** 監控：每個產品的服務燈號、最近 30 天的數字（用戶／7 天活躍／7 天新增／資料庫）、每週健檢 */
export async function monitorData(now = Date.now(), access: Access = { owner: true }) {
  const since = addDays(taipeiDate(new Date(now)), -30);
  const { monitorProducts } = await import("./monitor"); // monitor.ts 也引用這個檔案，動態載入避免互相引用
  const { readHealth } = await import("./health");
  const { productBreakdowns } = await import("./modules/registry");
  const [allProducts, st, daily, health, { projects }, breakdowns] = await Promise.all([
    monitorProducts().catch(() => []),
    db().from("monitor_status").select("service, product, ok, changed_at, checked_at, latency_ms, last_error"),
    db().from("monitor_daily").select("product, day, users, active7, new7, db_bytes").gte("day", since).order("day"),
    access.owner ? readHealth().catch(() => null) : null,
    listProjects(),
    access.owner ? productBreakdowns() : Promise.resolve([]),
  ]);
  const products = productsFor(access, projects.filter((p) => seesProject(access, p.id)).map((p) => p.slug), allProducts);
  type St = { service: string; product: string; ok: boolean; changed_at: string; checked_at: string | null; latency_ms: number | null; last_error: string | null };
  type Day = { product: string; day: string; users: number | null; active7: number | null; new7: number | null; db_bytes: number | null };
  const status = (st.data ?? []) as St[];
  const days = (daily.data ?? []) as Day[];
  return {
    ready: !st.error,
    products: products.map((p) => {
      const services = p.services.map((s) => {
        const row = status.find((r) => r.service === s.id);
        return { id: s.id, name: s.zh, checked: !!row?.checked_at, ok: row ? row.ok : null, since: row?.changed_at ?? null, latency_ms: row?.latency_ms ?? null, error: row && !row.ok ? row.last_error : null };
      });
      return {
        key: p.key,
        label: p.label,
        services,
        metrics: p.metrics ? { users: p.metrics.users[0], active7: p.metrics.active7[0], new7: p.metrics.new7[0] } : null,
        db_limit: p.dbLimitBytes ?? null,
        db_label: p.dbLabel?.[0] ?? null,
        hint: p.setupHint?.[0] ?? null,
        daily: days.filter((d) => d.product === p.key).map(({ day, users, active7, new7, db_bytes }) => ({ day, users, active7, new7, db_bytes })),
        breakdowns: breakdowns.filter((b) => b.product === p.key).map(({ product: _product, ...b }) => b),
      };
    }),
    health: health ? { at: health.at, issues: health.issues.map((i) => ({ level: i.level, text: i.zh })), days: health.stats.days, errors: health.stats.errors, ai_usd_week: health.stats.aiUsdWeek } : null,
  };
}
