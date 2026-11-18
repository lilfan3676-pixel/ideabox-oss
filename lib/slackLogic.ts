// Slack 進度回報的規則（純函式，方便測試）
import { daysBetween, isIsoDate } from "./dates";
import { stageName, type Milestone, type Project } from "./projectLogic";

// 加前綴避免把原本討論用的頻道（例如 #myapp）當成進度
export const SLACK_PREFIX = "progress-";
/** 一次回報最多新增幾個里程碑（送件時程總表這種一次十幾個日期的也要收得下） */
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

export type SlackAi = { log: string; next_step: string; stage: string; milestones: { title: string; due: string }[]; events?: { title: string; start: string; end: string }[] };

export type SlackPlan = {
  log: string;
  patch: { next_step?: string; stage?: number };
  milestones: { title: string; due: string }[];
  events: { title: string; start: string; end: string }[];
};

/** 把 AI 讀到的內容轉成要改的東西：階段要在清單裡、日期要是今天以後、重複的里程碑不加 */
export function planSlackUpdate(
  p: Project,
  ai: SlackAi,
  today: string,
  existing: Pick<Milestone, "project_id" | "title" | "due">[],
  existingEvents: { project_id: string; title: string; start_date: string }[] = [],
): SlackPlan {
  const patch: SlackPlan["patch"] = {};
  const next = String(ai.next_step ?? "").trim().slice(0, 200);
  if (next && next !== (p.next_step ?? "")) patch.next_step = next;
  const want = String(ai.stage ?? "").trim();
  const idx = want ? p.stages.findIndex((s) => s.toLowerCase() === want.toLowerCase()) : -1;
  if (idx >= 0 && idx !== p.stage) patch.stage = idx;
  const seen = new Set(existing.filter((m) => m.project_id === p.id).map((m) => `${m.title}|${m.due}`));
  // 同一天、標題互相包含（AI 重讀時措辭略有不同）也算重複
  const mineMs = existing.filter((m) => m.project_id === p.id).map((m) => ({ t: normTitle(m.title), d: m.due }));
  const milestones: SlackPlan["milestones"] = [];
  for (const m of Array.isArray(ai.milestones) ? ai.milestones : []) {
    const title = String(m?.title ?? "").trim().slice(0, 80);
    const due = String(m?.due ?? "").trim();
    if (!title || !isIsoDate(due) || daysBetween(today, due) < 0) continue;
    const key = `${title}|${due}`;
    if (seen.has(key) || mineMs.some((m) => m.d === due && sameTitle(m.t, normTitle(title)))) continue;
    seen.add(key);
    mineMs.push({ t: normTitle(title), d: due });
    milestones.push({ title, due });
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
  return { log: String(ai.log ?? "").trim().slice(0, 300), patch, milestones: milestones.slice(0, MAX_MILESTONES), events: events.slice(0, 20) };
}

export const planChanges = (plan: SlackPlan) =>
  plan.patch.next_step !== undefined || plan.patch.stage !== undefined || plan.milestones.length > 0 || plan.events.length > 0;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram 通知：從 Slack 讀到什麼、改了什麼 */
export function slackNotice(p: Project, plan: SlackPlan): string {
  const lines = [`📣 <b>${esc(p.name)}</b>｜從 Slack 更新`];
  if (plan.log) lines.push(`📝 ${esc(plan.log)}`);
  if (plan.patch.stage !== undefined) lines.push(`🔀 階段：${esc(stageName(p))} → ${esc(p.stages[plan.patch.stage] ?? "")}`);
  if (plan.patch.next_step !== undefined) lines.push(`👉 下一步：${esc(plan.patch.next_step)}`);
  for (const m of plan.milestones) lines.push(`📅 新增里程碑：${esc(m.title)}（${m.due.slice(5).replace("-", "/")}）`);
  const md = (d: string) => d.slice(5).replace("-", "/");
  for (const e of plan.events) lines.push(`🗓 新增排程：${esc(e.title)}（${e.start === e.end ? md(e.start) : `${md(e.start)}～${md(e.end)}`}）`);
  lines.push("", "不對的話按「改回來」，或回我「" + esc(p.slug) + " 下一步 ＿＿」");
  return lines.join("\n");
}
