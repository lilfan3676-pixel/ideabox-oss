// 各頁最上面那排「重點數字」與右欄用的計算（純函式，瀏覽器和測試都能用）
import type { Grant, Idea } from "./db";
import { chargesBetween, toTwd, type Expense } from "./costCalc";
import type { Category } from "./labels";
import { datedOpen, type Milestone, type Project } from "./projectLogic";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** 最近幾週每週有幾筆（由舊到新，最後一格是最近 7 天）；未來的時間、太舊的不算 */
export function weeklyCounts(times: Array<string | number>, now: number, weeks = 8): number[] {
  const out = Array<number>(weeks).fill(0);
  for (const t of times) {
    const ms = typeof t === "number" ? t : Date.parse(t);
    if (!Number.isFinite(ms) || ms > now) continue;
    const back = Math.floor((now - ms) / WEEK_MS);
    if (back < weeks) out[weeks - 1 - back]++;
  }
  return out;
}

export type IdeaInsights = {
  week: number; // 最近 7 天新增
  lastWeek: number; // 再前 7 天
  weekly: number[]; // 最近 8 週每週新增
  adopted: number;
  avgScore: number | null; // 有分數的平均（一位小數）
  top: { id: string; title: string; score: number } | null;
  dups: number; // 可能重複、還沒處理
  cats: { cat: Category | null; n: number }[]; // 分類分佈，多的在前，最多 6 項
  sources: { source: Idea["source"]; n: number }[];
  nudge: { id: string; title: string; days: number } | null; // 分數高、放很久還沒採用的那一則
};

export const NUDGE_MIN_SCORE = 7;
export const NUDGE_MIN_DAYS = 14;

const titleOf = (i: Idea) => (i.summary ?? i.content ?? i.url ?? "").trim().slice(0, 60);

export function ideaInsights(ideas: Idea[], now: number): IdeaInsights {
  const weekly = weeklyCounts(ideas.map((i) => i.created_at), now);
  const scored = ideas.filter((i) => typeof i.score_total === "number");
  const top = scored.reduce<Idea | null>((best, i) => (!best || i.score_total! > best.score_total! ? i : best), null);
  const catMap = new Map<Category | null, number>();
  const srcMap = new Map<Idea["source"], number>();
  for (const i of ideas) {
    catMap.set(i.category ?? null, (catMap.get(i.category ?? null) ?? 0) + 1);
    srcMap.set(i.source, (srcMap.get(i.source) ?? 0) + 1);
  }
  // 分數夠高、放超過兩週、還沒採用：挑分數最高的（同分挑放最久的）
  const waiting = ideas
    .filter((i) => i.status === "analyzed" && !i.adopted && (i.score_total ?? 0) >= NUDGE_MIN_SCORE && now - Date.parse(i.created_at) >= NUDGE_MIN_DAYS * DAY_MS)
    .sort((a, b) => b.score_total! - a.score_total! || Date.parse(a.created_at) - Date.parse(b.created_at))[0];
  return {
    week: weekly[weekly.length - 1],
    lastWeek: weekly[weekly.length - 2],
    weekly,
    adopted: ideas.filter((i) => i.adopted).length,
    avgScore: scored.length ? Math.round((scored.reduce((s, i) => s + i.score_total!, 0) / scored.length) * 10) / 10 : null,
    top: top ? { id: top.id, title: titleOf(top), score: top.score_total! } : null,
    dups: ideas.filter((i) => i.dup_of && !i.dup_dismissed).length,
    cats: [...catMap.entries()].map(([cat, n]) => ({ cat, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    sources: [...srcMap.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
    nudge: waiting ? { id: waiting.id, title: titleOf(waiting), days: Math.floor((now - Date.parse(waiting.created_at)) / DAY_MS) } : null,
  };
}

export type ProjectInsights = {
  active: number;
  paused: number; // 暫停或完成
  logsWeek: number;
  logsLastWeek: number;
  weekly: number[]; // 最近 8 週每週幾筆日誌
  upcoming: (Milestone & { due: string; days: number })[]; // 還沒完成、有日期而且在今天以後的待辦，近的在前
  overdue: number; // 還沒完成但已經過期
  open: number; // 還沒完成的待辦總數（沒日期的也算）
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function projectInsights(projects: Pick<Project, "id" | "status">[], milestones: Milestone[], activity: { at: string }[], today: string, now: number): ProjectInsights {
  const weekly = weeklyCounts(activity.map((a) => a.at), now);
  // 暫停、完成的專案不提醒，里程碑也不算
  const live = new Set(projects.filter((p) => p.status === "active").map((p) => p.id));
  const open = milestones.filter((m) => !m.done && live.has(m.project_id));
  const dated = datedOpen(open);
  return {
    active: live.size,
    paused: projects.length - live.size,
    logsWeek: weekly[weekly.length - 1],
    logsLastWeek: weekly[weekly.length - 2],
    weekly,
    upcoming: dated.filter((m) => m.due >= today).map((m) => ({ ...m, days: dayDiff(today, m.due) })),
    overdue: dated.filter((m) => m.due < today).length,
    open: open.length,
  };
}

export type ProjectDetailInsights = {
  logsWeek: number;
  logsLastWeek: number;
  weekly: number[]; // 最近 8 週每週幾筆日誌
  next: { title: string; due: string; days: number } | null; // 最近一個還沒完成、今天以後的里程碑
  overdue: number;
  msDone: number;
  msTotal: number;
  upcoming: (Milestone & { days: number | null })[]; // 還沒完成的待辦：有日期的在前（過期的也算，days 是負的），沒日期的排後面（days 是 null）
};

/** 單一專案詳細頁最上面那排數字 */
export function projectDetailInsights(milestones: Milestone[], logs: { at: string }[], today: string, now: number): ProjectDetailInsights {
  const weekly = weeklyCounts(logs.map((l) => l.at), now);
  const dated = datedOpen(milestones).map((m) => ({ ...m, days: dayDiff(today, m.due) }));
  const open = [...dated, ...milestones.filter((m) => !m.done && !m.due).map((m) => ({ ...m, days: null }))];
  const next = dated.find((m) => m.days >= 0) ?? null;
  return {
    logsWeek: weekly[weekly.length - 1],
    logsLastWeek: weekly[weekly.length - 2],
    weekly,
    next: next ? { title: next.title, due: next.due, days: next.days } : null,
    overdue: dated.filter((m) => m.days < 0).length,
    msDone: milestones.length - open.length,
    msTotal: milestones.length,
    upcoming: open,
  };
}

/** 月曆上某一段日期（含頭尾）裡有幾個排程、幾個里程碑 */
export function countInRange(items: { kind: "event" | "milestone"; start: string; end: string }[], from: string, to: string): { events: number; milestones: number } {
  let events = 0;
  let milestones = 0;
  for (const it of items) {
    if (it.start > to || it.end < from) continue;
    if (it.kind === "milestone") milestones++;
    else events++;
  }
  return { events, milestones };
}

export type GrantInsights = {
  open: number; // 還開放、沒標記不適合
  due3: number; // 3 天內截止
  due14: number; // 14 天內截止（含 3 天內）
  newWeek: number; // 最近 7 天新找到
  highFit: number; // 適合度 8 分以上
  timeline: { id: string; name: string; deadline: string; days: number }[]; // 接下來的截止日，近的在前
  byStatus: Record<"new" | "interested" | "applied", number>;
};

export const HIGH_FIT = 8;

export function grantInsights(all: Grant[], today: string, now: number): GrantInsights {
  const open = all.filter((g) => g.status !== "ignored" && (!g.deadline || g.deadline >= today));
  const dated = open.filter((g) => g.deadline).map((g) => ({ id: g.id, name: g.name, deadline: g.deadline!, days: dayDiff(today, g.deadline!) }));
  // 已申請的不用再提醒截止日
  const todo = new Set(open.filter((g) => g.status !== "applied").map((g) => g.id));
  const pending = dated.filter((g) => todo.has(g.id));
  return {
    open: open.length,
    due3: pending.filter((g) => g.days <= 3).length,
    due14: pending.filter((g) => g.days <= 14).length,
    newWeek: open.filter((g) => now - Date.parse(g.created_at) < WEEK_MS).length,
    highFit: open.filter((g) => (g.fit_score ?? 0) >= HIGH_FIT).length,
    timeline: pending.sort((a, b) => a.deadline.localeCompare(b.deadline)),
    byStatus: { new: open.filter((g) => g.status === "new").length, interested: open.filter((g) => g.status === "interested").length, applied: open.filter((g) => g.status === "applied").length },
  };
}

export type MonthCharge = { day: string; name: string; twd: number; kind: Expense["kind"] };

/** 這個月每一筆扣款（訂閱照實際扣款日、一次性照付款日），照日期排；算法跟成本頁「本月」一樣 */
export function monthCharges(expenses: Expense[], month: string, usdTwd: number): MonthCharge[] {
  const from = `${month}-01`;
  const to = `${month}-31`; // 字串比較用，31 號以後就是下個月
  const out: MonthCharge[] = [];
  for (const e of expenses) {
    const amount = toTwd(e.amount, e.currency, usdTwd);
    if (e.kind === "subscription") {
      for (const day of chargesBetween(e, from, to)) out.push({ day, name: e.name, twd: amount, kind: e.kind });
    } else if (e.paid_on && e.paid_on >= from && e.paid_on <= to) {
      out.push({ day: e.paid_on, name: e.name, twd: amount, kind: e.kind });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // 不用 localeCompare：伺服器和瀏覽器排出來要一樣
}

// ---------- 待辦：分組與「現在要注意的」 ----------

export type TodoGroups<T> = { urgent: T[]; later: T[]; someday: T[]; done: T[] };
/** 幾天內到期算「快到期」 */
export const URGENT_DAYS = 7;

/** 一個專案的待辦分四堆：過期或 7 天內到期（近的在前）／有日期但還早／沒訂日期／已完成 */
export function groupTodos<T extends Pick<Milestone, "due" | "done">>(ms: T[], today: string): TodoGroups<T> {
  const dated = datedOpen(ms);
  const edge = URGENT_DAYS;
  return {
    urgent: dated.filter((m) => dayDiff(today, m.due) <= edge),
    later: dated.filter((m) => dayDiff(today, m.due) > edge),
    someday: ms.filter((m) => !m.done && !m.due),
    done: ms.filter((m) => m.done),
  };
}

/** 總覽頁最上面「現在要注意的」預設看幾天內到期 */
export const FOCUS_DAYS = 3;

/** 全部進行中專案裡，過期或 3 天內到期、還沒做的待辦（最急的在前）。暫停、完成的專案不算 */
export function focusTodos(projects: Pick<Project, "id" | "status">[], ms: Milestone[], today: string, within = FOCUS_DAYS): (Milestone & { due: string; days: number })[] {
  const live = new Set(projects.filter((p) => p.status === "active").map((p) => p.id));
  return datedOpen(ms.filter((m) => live.has(m.project_id)))
    .map((m) => ({ ...m, days: dayDiff(today, m.due) }))
    .filter((m) => m.days <= within);
}
