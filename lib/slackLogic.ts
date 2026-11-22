// Slack 進度回報的規則（純函式，方便測試）
import { daysBetween, isIsoDate } from "./dates";
import { stageName, type Milestone, type Project } from "./projectLogic";

// 加前綴避免把原本討論用的頻道（例如 #myapp）當成進度
export const SLACK_PREFIX = "progress-";
/** 一次回報最多新增幾件待辦（送件時程總表這種一次十幾個日期的也要收得下） */
export const MAX_MILESTONES = 20;

const normTitle = (t: string) => t.toLowerCase().replace(/[\s，,。.、：:（）()【】\[\]「」\-—~～]/g, "");
const sameTitle = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

/** 專案對應的 Slack 頻道名稱：沒設定就用「progress-短名」（myapp → #progress-myapp） */
export const slackChannelFor = (p: Pick<Project, "slug" | "slack_channel">) =>
  String(p.slack_channel || SLACK_PREFIX + p.slug).trim().replace(/^#/, "").toLowerCase();

export type SlackMessage = { ts: string; text?: string; user?: string; bot_id?: string; subtype?: string };

// 一般訊息、別的 App 代發、從討論串轉發到頻道的都算；加入頻道、改主題這類系統訊息不算
const OK_SUBTYPES = new Set([undefined, "bot_message", "thread_broadcast", "file_share"]);

/** 挑出要讀的訊息（排除 ideabox 自己的 Bot、系統訊息、空白），由舊到新 */
export function usableMessages(msgs: SlackMessage[], selfUserId?: string | null): SlackMessage[] {
  return msgs
    .filter((m) => OK_SUBTYPES.has(m.subtype) && (m.text ?? "").trim() && !(selfUserId && m.user === selfUserId))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

/** 這批訊息讀完後，下次從哪裡繼續（最新那則的 ts；沒有就維持原本） */
export const nextCursor = (msgs: SlackMessage[], cur: string) =>
  msgs.reduce((max, m) => (Number(m.ts) > Number(max) ? m.ts : max), cur);

/** 給 AI 對照的「還沒做完的待辦」最多列幾件 */
export const MAX_OPEN_LISTED = 40;

/** 這個專案還沒做完的待辦，編號給 AI 對照用（有日期的在前、近的在前） */
export function openTodos<T extends Pick<Milestone, "project_id" | "title" | "due" | "done">>(projectId: string, all: T[]): T[] {
  return all
    .filter((m) => m.project_id === projectId && !m.done)
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, MAX_OPEN_LISTED);
}

// milestones＝要新增的待辦（due 可以是空字串＝沒有期限）；done＝回報說已經做完的待辦編號（從 1 開始，對照 openTodos 的順序）
export type SlackAi = { log: string; next_step: string; stage: string; milestones: { title: string; due?: string }[]; done?: number[]; events?: { title: string; start: string; end: string }[] };

export type SlackPlan = {
  log: string;
  patch: { next_step?: string; stage?: number };
  milestones: { title: string; due: string | null }[];
  /** 回報說做完了、要自動打勾的待辦 */
  done: { id: string; title: string }[];
  events: { title: string; start: string; end: string }[];
};

/** 把 AI 讀到的內容轉成要改的東西：階段要在清單裡、日期要是今天以後、重複的待辦不加、回報說做完的待辦打勾 */
export function planSlackUpdate(
  p: Project,
  ai: SlackAi,
  today: string,
  existing: (Pick<Milestone, "project_id" | "title" | "due"> & { id?: string; done?: boolean })[],
  existingEvents: { project_id: string; title: string; start_date: string }[] = [],
): SlackPlan {
  const patch: SlackPlan["patch"] = {};
  const next = String(ai.next_step ?? "").trim().slice(0, 200);
  if (next && next !== (p.next_step ?? "")) patch.next_step = next;
  const want = String(ai.stage ?? "").trim();
  const idx = want ? p.stages.findIndex((s) => s.toLowerCase() === want.toLowerCase()) : -1;
  if (idx >= 0 && idx !== p.stage) patch.stage = idx;
  const mine = existing.filter((m) => m.project_id === p.id);
  // 回報說做完的：AI 給的是 openTodos 的編號（從 1 開始），對不到的編號不理
  const open = openTodos(p.id, mine.map((m) => ({ ...m, done: !!m.done })));
  const done: SlackPlan["done"] = [];
  for (const n of Array.isArray(ai.done) ? ai.done : []) {
    const m = Number.isInteger(n) ? open[n - 1] : undefined;
    if (m?.id && !done.some((d) => d.id === m.id)) done.push({ id: m.id, title: m.title });
  }
  const seen = new Set(mine.map((m) => `${m.title}|${m.due ?? ""}`));
  // 同一天、標題互相包含（AI 重讀時措辭略有不同）也算重複；
  // 沒日期的待辦只跟「還沒做完的」比標題（做完的事之後可能真的要再做一次）
  const mineMs = mine.map((m) => ({ t: normTitle(m.title), d: m.due ?? "", open: !m.done }));
  const milestones: SlackPlan["milestones"] = [];
  for (const m of Array.isArray(ai.milestones) ? ai.milestones : []) {
    const title = String(m?.title ?? "").trim().slice(0, 80);
    const due = String(m?.due ?? "").trim();
    if (!title) continue;
    if (due && (!isIsoDate(due) || daysBetween(today, due) < 0)) continue;
    const key = `${title}|${due}`;
    const t = normTitle(title);
    if (seen.has(key)) continue;
    if (due ? mineMs.some((x) => x.d === due && sameTitle(x.t, t)) : mineMs.some((x) => x.open && sameTitle(x.t, t))) continue;
    // 這次回報才說做完的事，不要又加回待辦
    if (done.some((d) => sameTitle(normTitle(d.title), t))) continue;
    seen.add(key);
    mineMs.push({ t, d: due, open: true });
    milestones.push({ title, due: due || null });
  }
  // 排程：日期要對、結束不早於開始，可以是過去 60 天內（補記）；重複的不加
  const seenEv = new Set(existingEvents.filter((e) => e.project_id === p.id).map((e) => `${e.title}|${e.start_date}`));
  const mineEv = existingEvents.filter((e) => e.project_id === p.id).map((e) => ({ t: normTitle(e.title), d: e.start_date }));
  const events: SlackPlan["events"] = [];
  for (const e of Array.isArray(ai.events) ? ai.events : []) {
    const title = String(e?.title ?? "").trim().slice(0, 80);
    const start = String(e?.start ?? "").trim();
    const end = String(e?.end ?? "").trim() || start;
    if (!title || !isIsoDate(start) || !isIsoDate(end) || end < start || daysBetween(start, today) > 60 || daysBetween(start, end) > 366) continue;
    const key = `${title}|${start}`;
    if (seenEv.has(key) || mineEv.some((x) => x.d === start && sameTitle(x.t, normTitle(title)))) continue;
    seenEv.add(key);
    mineEv.push({ t: normTitle(title), d: start });
    events.push({ title, start, end });
  }
  return { log: String(ai.log ?? "").trim().slice(0, 300), patch, milestones: milestones.slice(0, MAX_MILESTONES), done, events: events.slice(0, 20) };
}

export const planChanges = (plan: SlackPlan) =>
  plan.patch.next_step !== undefined || plan.patch.stage !== undefined || plan.milestones.length > 0 || plan.done.length > 0 || plan.events.length > 0;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram 通知：從 Slack 讀到什麼、改了什麼 */
export function slackNotice(p: Project, plan: SlackPlan): string {
  const lines = [`📣 <b>${esc(p.name)}</b>｜從 Slack 更新`];
  if (plan.log) lines.push(`📝 ${esc(plan.log)}`);
  if (plan.patch.stage !== undefined) lines.push(`🔀 階段：${esc(stageName(p))} → ${esc(p.stages[plan.patch.stage] ?? "")}`);
  if (plan.patch.next_step !== undefined) lines.push(`👉 下一步：${esc(plan.patch.next_step)}`);
  for (const d of plan.done) lines.push(`✅ 待辦打勾：${esc(d.title)}`);
  for (const m of plan.milestones) lines.push(`📋 新增待辦：${esc(m.title)}${m.due ? `（${m.due.slice(5).replace("-", "/")}）` : ""}`);
  const md = (d: string) => d.slice(5).replace("-", "/");
  for (const e of plan.events) lines.push(`🗓 新增排程：${esc(e.title)}（${e.start === e.end ? md(e.start) : `${md(e.start)}～${md(e.end)}`}）`);
  lines.push("", "不對的話按「改回來」，或回我「" + esc(p.slug) + " 下一步 ＿＿」");
  return lines.join("\n");
}
