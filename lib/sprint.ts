import "server-only";
import { taipeiDate } from "./dates";
import { db } from "./db";
import { env } from "./env";
import type { Milestone, Project, ProjectEvent } from "./projectLogic";
import { cleanSprints, planSprint, shouldSend, slotAt, sprintMessage, type Slot, type Sprint, type SprintButton } from "./sprintLogic";
import { esc, sendToOwnerWithButtons } from "./telegram";

// 衝刺提醒：某個專案有不能錯過的期限時，到期限前每天早上 8 點、晚上 9 點半各傳一則 Telegram＋手機推送，
// 寫「倒數幾天、今天該做什麼」。使用者 2026-11-21 要的（報名截止前每天提醒）。
// 跟著每 5 分鐘的 /api/monitor/tick 一起跑；設定存在 settings.sprints（JSON 陣列），傳過的時段記在 settings.sprint_sent。
// 開關：Telegram「<短名> 衝刺 11/30 12:00 報名截止」「<短名> 衝刺 取消」，或訊息下面的「已經完成，停止提醒」。

const KEY = "sprints";
const SENT_KEY = "sprint_sent";
const DAY = 86_400_000;
const taipeiMinutes = (now: number) => Math.floor(((((now + 8 * 3_600_000) % DAY) + DAY) % DAY) / 60_000);

export async function listSprints(): Promise<Sprint[]> {
  const { data } = await db().from("settings").select("value").eq("key", KEY).maybeSingle();
  return cleanSprints((data as { value: unknown } | null)?.value);
}

async function saveSprints(list: Sprint[]) {
  if (!list.length) await db().from("settings").delete().eq("key", KEY);
  else await db().from("settings").upsert({ key: KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() });
}

async function setMark(value: string | null) {
  if (!value) await db().from("settings").delete().eq("key", SENT_KEY);
  else await db().from("settings").upsert({ key: SENT_KEY, value, updated_at: new Date().toISOString() });
}

/** 開始（或改）某個專案的衝刺。回傳要回給使用者的訊息 */
export async function startSprint(p: Project, due: string, title: string, time: string | null): Promise<string> {
  const list = (await listSprints()).filter((s) => s.project !== p.id);
  list.push({ project: p.id, due, title, time });
  await saveSprints(list);
  // 讓下一次排程（5 分鐘內）就先傳第一則，不用等到明天早上
  await setMark(null);
  return `🔥 ${esc(p.name)} 開始衝刺：${esc(title)}（${due.slice(5).replace("-", "/")}${time ? ` ${time}` : ""}）\n到那天之前，每天早上 8 點和晚上 9 點半提醒你今天該做什麼；第一則幾分鐘內就會傳（早上 8 點前設定的話 8 點傳）。\n停止：回我「${esc(p.slug)} 衝刺 取消」`;
}

/** 停止某個專案的衝刺；本來就沒有回傳 false */
export async function stopSprint(projectId: string): Promise<boolean> {
  const list = await listSprints();
  if (!list.some((s) => s.project === projectId)) return false;
  await saveSprints(list.filter((s) => s.project !== projectId));
  return true;
}

async function sprintFor(p: Project, s: Sprint, slot: Slot, today: string) {
  const [ms, ev] = await Promise.all([
    db().from("project_milestones").select("*").eq("project_id", p.id),
    db().from("project_events").select("*").eq("project_id", p.id).lte("start_date", today).gte("end_date", today),
  ]);
  const plan = planSprint(s, (ms.data ?? []) as Milestone[], (ev.data ?? []) as ProjectEvent[], today);
  return sprintMessage(p, s, plan, slot, today, env.appUrl());
}

/** 每 5 分鐘被呼叫一次：早上 8 點後、晚上 9 點半後各傳一次。回傳傳了幾則 */
export async function runSprint(now = Date.now()): Promise<number> {
  if (!env.telegramOwnerId()) return 0;
  const slot = slotAt(taipeiMinutes(now));
  if (!slot) return 0;
  const all = await listSprints();
  if (!all.length) return 0;
  const today = taipeiDate(new Date(now));
  // 過了期限的自動結束
  const list = all.filter((s) => s.due >= today);
  if (list.length !== all.length) await saveSprints(list);
  if (!list.length) return 0;
  const { data: row } = await db().from("settings").select("value").eq("key", SENT_KEY).maybeSingle();
  const before = (row as { value: string } | null)?.value ?? null;
  if (!shouldSend(slot, today, before)) return 0;
  // 先記「這個時段傳過了」再傳，避免每 5 分鐘重複；全部都沒傳出去才改回來
  await setMark(`${today}:${slot}`);
  const { data: ps } = await db().from("projects").select("*").in("id", list.map((s) => s.project));
  const projects = (ps ?? []) as Project[];
  let tried = 0;
  let sent = 0;
  for (const s of list) {
    const p = projects.find((x) => x.id === s.project);
    if (!p || p.status !== "active") continue; // 暫停、完成的專案不提醒
    tried++;
    const m = await sprintFor(p, s, slot, today);
    if (!(await sendToOwnerWithButtons(m.html, m.buttons))) continue;
    sent++;
    const { sendPushSafe } = await import("./app");
    await sendPushSafe({ ...m.push, data: { screen: "today" } });
  }
  if (tried && !sent) await setMark(before);
  return sent;
}

/** 晚上的進度確認不要重複問：正在衝刺的專案交給衝刺提醒 */
export async function sprintProjectIds(today: string): Promise<Set<string>> {
  return new Set((await listSprints()).filter((s) => s.due >= today).map((s) => s.project));
}

export type SprintButtonResult = { toast: string; html?: string; buttons?: SprintButton[][] | null; reply?: string };

/** 衝刺訊息的按鈕。sp:d:<a 早｜p 晚>:<待辦 id>＝這件做了（打勾後把原訊息換成最新的）；sp:e:<專案 id>＝完成了，停止提醒 */
export async function handleSprintButton(data: string, now = Date.now()): Promise<SprintButtonResult> {
  const [, action, a, b] = data.split(":");
  const { getProject, logActivity } = await import("./projects");
  if (action === "e" && a) {
    const p = await getProject(a);
    if (!(await stopSprint(a))) return { toast: "這個提醒已經停了", buttons: null };
    if (p) await logActivity(p.id, "衝刺結束：按了「已經完成」", "telegram");
    return { toast: "不再提醒了", buttons: null, reply: `🏁 ${esc(p?.name ?? "")} 的每天提醒停了，辛苦了！\n按錯的話回我「${esc(p?.slug ?? "短名")} 衝刺 日期 標題」就會重新開始。` };
  }
  if (action === "d" && b) {
    const { data: row } = await db().from("project_milestones").select("*").eq("id", b).maybeSingle();
    const m = row as Milestone | null;
    if (!m) return { toast: "這件待辦已經不在了" };
    const already = m.done;
    if (!already) {
      await db().from("project_milestones").update({ done: true }).eq("id", b);
      await logActivity(m.project_id, `完成待辦：${m.title}`, "telegram");
    }
    // 把原訊息換成打勾之後的樣子
    const today = taipeiDate(new Date(now));
    const s = (await listSprints()).find((x) => x.project === m.project_id);
    const p = s ? await getProject(m.project_id) : null;
    if (!s || !p) return { toast: already ? "這個已經打勾了" : "打勾了", buttons: null };
    const next = await sprintFor(p, s, a === "p" ? "pm" : "am", today);
    return { toast: already ? "這個已經打勾了" : "打勾了", html: next.html, buttons: next.buttons };
  }
  return { toast: "" };
}
