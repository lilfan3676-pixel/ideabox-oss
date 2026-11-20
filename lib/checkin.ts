import "server-only";
import { createHash } from "node:crypto";
import { daysBetween, taipeiDate } from "./dates";
import { db } from "./db";
import { env } from "./env";
import type { Milestone, Project } from "./projectLogic";
import { getProject, listProjects, logActivity } from "./projects";
import { esc, sendToOwnerWithButtons, type Button } from "./telegram";

// 每晚進度確認：里程碑不會自己打勾，所以每天台北 21:30 用 Telegram 問主人
// 「到期的里程碑做了嗎」「下一步做完了嗎」，按按鈕就直接更新。
// 跟著每 5 分鐘的 /api/monitor/tick 一起跑，一天只問一次（settings.checkin_day）；沒有要問的就不傳。

const DAY_KEY = "checkin_day";
/** 台北時間幾點幾分之後才問（21:30） */
export const ASK_AFTER_MIN = 21 * 60 + 30;
/** 一次最多問幾個里程碑／幾個專案的下一步，避免洗版 */
export const MAX_ASK = 8;

const DAY = 86_400_000;
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

/** 台北時間現在是當天的第幾分鐘（台灣沒有日光節約時間） */
export const taipeiMinutes = (now: number) => Math.floor((((now + 8 * 3_600_000) % DAY) + DAY) % DAY / 60_000);

import { addDays } from "./dates";

export { addDays };

/** 下一步的短指紋：按鈕按下去時確認問的還是同一件事（隔幾天才按、下一步已經換了就不動） */
export const stepKey = (text: string) => createHash("sha1").update(text.trim()).digest("hex").slice(0, 6);

export type CheckinAsk =
  | { kind: "milestone"; project: Project; milestone: Milestone; late: number }
  | { kind: "step"; project: Project; step: string };

/** 要問哪些：進行中專案裡「今天到期或已過期、還沒打勾」的里程碑（越早到期越前面），加上每個進行中專案的下一步 */
export function planCheckin(projects: Project[], milestones: Milestone[], today: string): CheckinAsk[] {
  const active = projects.filter((p) => p.status === "active");
  const byId = new Map(active.map((p) => [p.id, p]));
  const due = milestones
    .filter((m) => !m.done && m.due <= today && byId.has(m.project_id))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, MAX_ASK)
    .map((m): CheckinAsk => ({ kind: "milestone", project: byId.get(m.project_id)!, milestone: m, late: daysBetween(m.due, today) }));
  const steps = active
    .filter((p) => p.next_step?.trim())
    .slice(0, MAX_ASK)
    .map((p): CheckinAsk => ({ kind: "step", project: p, step: p.next_step!.trim() }));
  return [...due, ...steps];
}

export function askMessage(a: CheckinAsk): { html: string; buttons: Button[][] } {
  if (a.kind === "milestone") {
    const when = a.late === 0 ? "今天到期" : `${md(a.milestone.due)} 到期，過了 ${a.late} 天`;
    const id = a.milestone.id;
    return {
      html: `🏁 <b>${esc(a.project.name)}</b>｜里程碑\n${esc(a.milestone.title)}（${when}）\n\n做了嗎？`,
      buttons: [
        [{ text: "✅ 做了", data: `ck:m:d:${id}` }],
        [{ text: "⏰ 延 3 天", data: `ck:m:3:${id}` }, { text: "⏰ 延 1 週", data: `ck:m:7:${id}` }, { text: "先不動", data: `ck:m:x:${id}` }],
      ],
    };
  }
  const tail = `${a.project.id}:${stepKey(a.step)}`;
  return {
    html: `👉 <b>${esc(a.project.name)}</b>｜下一步\n${esc(a.step)}\n\n做完了嗎？`,
    buttons: [[{ text: "✅ 做完了", data: `ck:n:d:${tail}` }, { text: "還沒", data: `ck:n:x:${tail}` }]],
  };
}

async function setDay(value: string | null) {
  if (value === null) await db().from("settings").delete().eq("key", DAY_KEY);
  else await db().from("settings").upsert({ key: DAY_KEY, value, updated_at: new Date().toISOString() });
}

/** 每 5 分鐘被呼叫一次；台北 21:30 之後、今天還沒問過才問。回傳傳了幾則 */
export async function runCheckin(now = Date.now()): Promise<number> {
  if (!env.telegramOwnerId() || taipeiMinutes(now) < ASK_AFTER_MIN) return 0;
  const today = taipeiDate(new Date(now));
  const { data: mark } = await db().from("settings").select("value").eq("key", DAY_KEY).maybeSingle();
  if ((mark as { value: string } | null)?.value === today) return 0;
  const { projects, ready } = await listProjects();
  if (!ready) return 0;
  // 先記「今天問過了」再傳，避免每 5 分鐘重複問；全部都沒傳出去才改回來
  await setDay(today);
  const { data } = await db().from("project_milestones").select("*").eq("done", false).lte("due", today);
  const asks = planCheckin(projects, (data ?? []) as Milestone[], today);
  let sent = 0;
  for (const a of asks) {
    const m = askMessage(a);
    if (await sendToOwnerWithButtons(m.html, m.buttons)) sent++;
  }
  if (asks.length && !sent) await setDay(null);
  return sent;
}

type ButtonResult = { toast: string; done: boolean; text?: string };

/** 進度確認的按鈕。里程碑：ck:m:<d 做了｜3、7 延幾天｜x 先不動>:<里程碑 id>；下一步：ck:n:<d 做完｜x 還沒>:<專案 id>:<指紋> */
export async function handleCheckinButton(data: string, now = Date.now()): Promise<ButtonResult> {
  const [, kind, action, id, key] = data.split(":");
  if (kind === "m" && id) {
    const { data: row } = await db().from("project_milestones").select("*").eq("id", id).maybeSingle();
    const m = row as Milestone | null;
    if (!m) return { toast: "這個里程碑已經不在了", done: true };
    if (m.done) return { toast: "這個已經打勾了", done: true };
    if (action === "d") {
      await db().from("project_milestones").update({ done: true }).eq("id", id);
      await logActivity(m.project_id, `完成里程碑：${m.title}`, "telegram");
      return { toast: "打勾了", done: true, text: `✅ 已打勾：${esc(m.title)}` };
    }
    if (action === "3" || action === "7") {
      const due = addDays(taipeiDate(new Date(now)), +action);
      await db().from("project_milestones").update({ due, reminded_7: false, reminded_1: false }).eq("id", id);
      await logActivity(m.project_id, `里程碑延期：${m.title}（${md(m.due)} → ${md(due)}）`, "telegram");
      return { toast: `延到 ${md(due)}`, done: true, text: `⏰ ${esc(m.title)} 延到 ${md(due)}，到期那天再問你。要改成別的日期可以到網站的專案頁改。` };
    }
    return { toast: "好，明天再問你", done: true };
  }
  if (kind === "n" && id) {
    const p = await getProject(id);
    if (!p) return { toast: "這個專案已經不在了", done: true };
    const step = p.next_step?.trim() ?? "";
    if (!step || stepKey(step) !== key) return { toast: "下一步已經換過了，這則不用管", done: true };
    if (action === "d") {
      await logActivity(p.id, `完成：${step}`, "telegram");
      await db().from("projects").update({ next_step: null }).eq("id", p.id);
      return { toast: "記到日誌了", done: true, text: `✅ 已記到 ${esc(p.name)} 的日誌：完成「${esc(step)}」\n\n新的下一步是什麼？回我：\n<code>${esc(p.slug)} 下一步 要做的事</code>` };
    }
    return { toast: "好，明天再問你", done: true };
  }
  return { toast: "", done: false };
}
