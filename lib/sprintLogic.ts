// 衝刺提醒的規則（純函式，方便測試）：
// 某個專案有個不能錯過的期限（例如報名截止）時，到期限前每天早上、晚上各傳一則「倒數幾天＋今天該做什麼」。
// 要做的事就是這個專案「還沒打勾、期限在衝刺期限以前（或沒日期）」的待辦，加上今天的排程。
import { addDays, daysBetween, isIsoDate } from "./dates";
import type { Milestone, Project, ProjectEvent } from "./projectLogic";

/** project＝專案 id；due＝期限那天；time＝期限那天幾點（選填，台北時間 HH:MM） */
export type Sprint = { project: string; due: string; title: string; time?: string | null };
export type Slot = "am" | "pm";
export type SprintButton = { text: string; data: string };

/** 早上 8 點、晚上 9 點半之後各傳一次 */
export const AM_MIN = 8 * 60;
export const PM_MIN = 21 * 60 + 30;
/** 訊息下面最多放幾顆「做了」按鈕 */
export const MAX_BUTTONS = 6;
/** 「接下來」最多列幾件 */
export const MAX_UPCOMING = 4;

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const weekday = (d: string) => WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];

/** 設定裡存的內容整理成乾淨的清單（壞掉的、重複專案的丟掉） */
export function cleanSprints(v: unknown): Sprint[] {
  let raw = v;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: Sprint[] = [];
  for (const x of raw as Partial<Sprint>[]) {
    if (!x || typeof x.project !== "string" || !isIsoDate(x.due) || out.some((s) => s.project === x.project)) continue;
    const time = typeof x.time === "string" && /^\d{2}:\d{2}$/.test(x.time) ? x.time : null;
    out.push({ project: x.project, due: x.due, title: String(x.title ?? "").trim().slice(0, 40) || "期限", time });
  }
  return out;
}

/** 現在（台北時間當天第幾分鐘）該傳哪一則；早上 8 點前不傳 */
export const slotAt = (minutes: number): Slot | null => (minutes >= PM_MIN ? "pm" : minutes >= AM_MIN ? "am" : null);

/** mark＝上次傳的「日期:時段」。晚上那則傳過，當天就都不用再傳；早上那則傳過，晚上還要傳 */
export function shouldSend(slot: Slot, today: string, mark: string | null | undefined): boolean {
  if (mark === `${today}:pm`) return false;
  return !(slot === "am" && mark === `${today}:am`);
}

export type SprintPlan = {
  daysLeft: number;
  overdue: Milestone[];
  today: Milestone[];
  upcoming: Milestone[];
  undated: Milestone[];
  events: ProjectEvent[];
  done: number;
  total: number;
};

/** 把這個專案的待辦分成：過期的、今天到期的、接下來的、沒排日期的（期限在衝刺期限之後的不算） */
export function planSprint(s: Sprint, milestones: Milestone[], events: ProjectEvent[], today: string): SprintPlan {
  const mine = milestones.filter((m) => m.project_id === s.project && (!m.due || m.due <= s.due));
  const open = mine.filter((m) => !m.done);
  const dated = open.filter((m) => !!m.due).sort((a, b) => a.due!.localeCompare(b.due!));
  return {
    daysLeft: daysBetween(today, s.due),
    overdue: dated.filter((m) => m.due! < today),
    today: dated.filter((m) => m.due === today),
    upcoming: dated.filter((m) => m.due! > today),
    undated: open.filter((m) => !m.due),
    events: events.filter((e) => e.project_id === s.project && e.start_date <= today && e.end_date >= today),
    done: mine.length - open.length,
    total: mine.length,
  };
}

const countdown = (s: Sprint, daysLeft: number) => {
  const at = s.time ? ` ${s.time} ` : "";
  if (daysLeft <= 0) return `今天${at}截止`;
  if (daysLeft === 1) return `明天${at}截止`;
  return `倒數 ${daysLeft} 天`;
};

export type SprintMessage = { html: string; buttons: SprintButton[][]; push: { title: string; body: string } };

/** 早上那則：倒數＋今天要做完的事；晚上那則：今天還沒打勾的＋明天要做的 */
export function sprintMessage(p: Pick<Project, "id" | "name" | "slug">, s: Sprint, plan: SprintPlan, slot: Slot, today: string, appUrl?: string | null): SprintMessage {
  const focus = [...plan.overdue, ...plan.today];
  const left = plan.total - plan.done;
  const lines: string[] = [
    `${slot === "am" ? "🔥" : "🌙"} <b>${esc(p.name)}｜${esc(s.title)}・${countdown(s, plan.daysLeft)}</b>`,
    `期限：${md(s.due)}（${weekday(s.due)}）${s.time ? ` ${s.time}` : ""}・待辦完成 ${plan.done}／${plan.total}`,
  ];

  if (!left) {
    lines.push("", "清單上的事都做完了 🎉", "真的送出、確認成功之後，按下面的按鈕，我就不再提醒。");
  } else if (slot === "am") {
    if (plan.overdue.length) {
      lines.push("", "🔴 <b>已經過期，今天先補</b>");
      for (const m of plan.overdue) lines.push(`・${esc(m.title)}（${md(m.due!)}，過了 ${daysBetween(m.due!, today)} 天）`);
    }
    if (plan.today.length) {
      lines.push("", "🎯 <b>今天要做完</b>");
      plan.today.forEach((m, i) => lines.push(`${i + 1}. ${esc(m.title)}`));
    }
    if (!focus.length) {
      const next = plan.upcoming[0] ?? plan.undated[0];
      lines.push("", "🎯 <b>今天沒有到期的事，可以先做下一件</b>", `・${esc(next.title)}${next.due ? `（${md(next.due)} 到期）` : ""}`);
    }
    if (plan.events.length) {
      lines.push("", "🗓 <b>今天的排程</b>");
      for (const e of plan.events) lines.push(`・${esc(e.title)}${e.start_date === e.end_date ? "" : `（${md(e.start_date)}～${md(e.end_date)}）`}`);
    }
    const rest = focus.length ? plan.upcoming : plan.upcoming.slice(1);
    if (rest.length) {
      lines.push("", "⏭ <b>接下來</b>");
      for (const m of rest.slice(0, MAX_UPCOMING)) lines.push(`・${md(m.due!)}（${weekday(m.due!)}）${esc(m.title)}`);
      if (rest.length > MAX_UPCOMING) lines.push(`・…還有 ${rest.length - MAX_UPCOMING} 件`);
    }
    if (plan.undated.length) lines.push("", `📋 沒排日期的還有 ${plan.undated.length} 件：${plan.undated.slice(0, 3).map((m) => esc(m.title)).join("、")}`);
  } else {
    if (focus.length) {
      lines.push("", "⚠️ <b>今天還沒打勾</b>（做完了就按下面的按鈕）");
      for (const m of focus) lines.push(`・${esc(m.title)}${m.due! < today ? `（${md(m.due!)} 就該做完）` : ""}`);
    } else {
      lines.push("", "✅ 今天該做的都打勾了，辛苦了。");
    }
    const tomorrow = addDays(today, 1);
    const tm = plan.upcoming.filter((m) => m.due === tomorrow);
    if (tm.length) {
      lines.push("", "🌅 <b>明天要做完</b>");
      for (const m of tm) lines.push(`・${esc(m.title)}`);
    } else if (plan.upcoming[0]) {
      lines.push("", `⏭ 下一件：${md(plan.upcoming[0].due!)} ${esc(plan.upcoming[0].title)}`);
    }
  }
  if (appUrl) lines.push("", `${appUrl.replace(/\/+$/, "")}/projects/${p.slug}`);

  // 按鈕：過期＋今天的各一顆「做了」；今天沒有到期的事就放下一件，方便提早打勾
  const tick = (focus.length ? focus : [plan.upcoming[0] ?? plan.undated[0]]).filter(Boolean).slice(0, MAX_BUTTONS);
  const buttons: SprintButton[][] = tick.map((m) => [{ text: `✅ ${m.title.slice(0, 22)}`, data: `sp:d:${slot === "am" ? "a" : "p"}:${m.id}` }]);
  buttons.push([{ text: "🏁 已經完成，停止提醒", data: `sp:e:${p.id}` }]);

  const names = focus.map((m) => m.title);
  const body = !left
    ? "清單上的事都做完了，確認送出後按「停止提醒」"
    : names.length
      ? `${slot === "am" ? "今天" : "還沒打勾"}：${names.slice(0, 3).join("、")}${names.length > 3 ? `…共 ${names.length} 件` : ""}`
      : slot === "am"
        ? `今天沒有到期的事，下一件：${(plan.upcoming[0] ?? plan.undated[0]).title}`
        : "今天該做的都打勾了";
  return { html: lines.join("\n"), buttons, push: { title: `${slot === "am" ? "🔥" : "🌙"} ${p.name}｜${s.title}・${countdown(s, plan.daysLeft)}`, body } };
}
