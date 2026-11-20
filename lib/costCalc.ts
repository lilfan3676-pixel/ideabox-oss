// 成本總覽的純計算（前後端共用、有單元測試）

import { MODULE_PURPOSE } from "./modules/labels";

/** 花費算在哪個產品：專案短名、ideabox（這個主控台自己）或 shared（共用） */
export type Product = string;
export type ProductOption = { key: string; zh: string; en: string };

/** 成本頁可選的產品：每個專案＋ideabox＋共用；資料裡有、但已經沒有對應專案的也列出來 */
export function productOptions(projects: { slug: string; name: string }[], used: string[] = []): ProductOption[] {
  const out: ProductOption[] = projects.map((p) => ({ key: p.slug, zh: p.name, en: p.name }));
  const has = (k: string) => out.some((o) => o.key === k);
  for (const k of used) if (k && k !== "ideabox" && k !== "shared" && !has(k)) out.push({ key: k, zh: k, en: k });
  if (!has("ideabox")) out.push({ key: "ideabox", zh: "ideabox", en: "ideabox" });
  out.push({ key: "shared", zh: "共用", en: "Shared" });
  return out;
}

export type Currency = "TWD" | "USD";
export type Cycle = "monthly" | "yearly";

export type Expense = {
  id: string;
  name: string;
  product: Product;
  kind: "subscription" | "one_time";
  amount: number;
  currency: Currency;
  cycle: Cycle | null; // 訂閱才有
  next_due: string | null; // 訂閱：下次扣款日 YYYY-MM-DD
  paid_on: string | null; // 一次性：付款日
  note: string | null;
  active: boolean;
  reminded_for: string | null;
  created_at: string;
  started_on?: string | null; // 訂閱：開始訂閱日（選填，migration-017；累計支出從這天之後才算）
};

export type AiUsageRow = { at: string; model: string; purpose: string; product: Product; usd: number };

// ---------- Claude API 價格（美元／百萬 tokens；2026-10 官方定價） ----------

type Price = { input: number; output: number };
const PRICES: Array<[RegExp, Price]> = [
  [/haiku/i, { input: 0.1, output: 0.5 }],
  [/sonnet/i, { input: 2, output: 10 }],
];
export const WEB_SEARCH_USD = 10 / 1000; // 每次搜尋

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
};

/** 一次 API 呼叫的費用（美元）。不認得的模型以 Sonnet 價格估算（寧可高估） */
export function usdCost(model: string, u: Usage | undefined): number {
  if (!u) return 0;
  const p = PRICES.find(([re]) => re.test(model))?.[1] ?? PRICES[1][1];
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1;
  const tokens = (input * p.input + (u.output_tokens ?? 0) * p.output) / 1_000_000;
  return tokens + (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD;
}

export const PURPOSE_LABEL: Record<string, string> = {
  idea_analysis: "點子分析",
  grant_radar: "補助雷達",
  topic_radar: "話題雷達",
  post_draft: "發文草稿",
  social_plan: "每週內容規劃",
  social_metrics: "成效截圖讀數字",
  social_audit: "成效解讀",
  social_reply: "留言回覆草稿",
  social_dm: "私訊草稿",
  social_comment: "留言草稿",
  social_profile: "個人檔案健檢",
  weekly_digest: "週報",
  learning: "自我學習",
  office_task: "辦公室任務摘要",
  slack_progress: "Slack 進度整理",
  other: "其他",
  ...Object.fromEntries(Object.entries(MODULE_PURPOSE).map(([k, v]) => [k, v.zh])),
};
export const PURPOSE_LABEL_EN: Record<string, string> = {
  idea_analysis: "Idea analysis",
  grant_radar: "Grant radar",
  topic_radar: "Topic radar",
  post_draft: "Post drafts",
  social_plan: "Weekly content plan",
  social_metrics: "Reading post insights",
  social_audit: "Post performance review",
  social_reply: "Comment replies",
  social_dm: "DM drafts",
  social_comment: "Comment drafts",
  social_profile: "Profile check",
  weekly_digest: "Weekly digest",
  learning: "Self-learning",
  office_task: "Office task summary",
  slack_progress: "Slack progress sync",
  other: "Other",
  ...Object.fromEntries(Object.entries(MODULE_PURPOSE).map(([k, v]) => [k, v.en])),
};
/** AI 用途屬於哪個產品 */
export function purposeProduct(purpose: string): Product {
  return MODULE_PURPOSE[purpose]?.product ?? "ideabox";
}

// ---------- 日期 ----------

function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last)); // 1/31 的下個月是 2/28
  return target.toISOString().slice(0, 10);
}

/** 扣款日已過就往後推到今天或之後（月付每月、年付每年） */
export function rollDue(due: string, cycle: Cycle, today: string): string {
  let d = due;
  let n = 0;
  // 依原始日期計算，避免 1/31 → 2/28 → 3/28 越推越早
  while (d < today && n < 600) {
    n++;
    d = addMonths(due, cycle === "monthly" ? n : 12 * n);
  }
  return d;
}

// ---------- 總預算 ----------

export type Budget = { total: number; start: string }; // 台幣、起算日 YYYY-MM-DD（起算日自動 = 第一筆成本紀錄那天）

/** 起算日：第一次真的付錢的那天 = 一次性開銷的付款日、訂閱的「開始訂閱日」中最早的（今天以後的不算）。
 *  都沒有時才用最早加進 ideabox 的那天 */
export function firstRecordDay(expenses: Pick<Expense, "created_at" | "paid_on" | "started_on">[], today: string): string {
  let first = "";
  for (const e of expenses) {
    for (const d of [e.paid_on, e.started_on]) if (d && d <= today && (!first || d < first)) first = d;
  }
  if (first) return first;
  first = today;
  for (const e of expenses) {
    const added = taipeiDay(e.created_at);
    if (added < first) first = added;
  }
  return first;
}

const taipeiDay = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);

/** 訂閱從 from 到 today（含）之間實際扣過哪幾天：從下次扣款日往回推。
 *  已停用的訂閱，下次扣款日那一次沒有真的扣，不算 */
export function pastCharges(e: Pick<Expense, "kind" | "cycle" | "next_due" | "started_on"> & { active?: boolean }, from: string, today: string): string[] {
  if (e.kind !== "subscription" || !e.cycle || !e.next_due) return [];
  const lower = e.started_on && e.started_on > from ? e.started_on : from;
  const step = e.cycle === "monthly" ? 1 : 12;
  const out: string[] = [];
  // 依原始日期往回算（1/31 → 12/31 → 11/30…），最多 20 年
  for (let n = e.active === false ? 1 : 0; n < 240; n++) {
    const d = addMonths(e.next_due, -n * step);
    if (d < lower) break;
    if (d <= today) out.push(d);
  }
  return withStartCharge(out.reverse(), e, from, today);
}

/** 訂閱在 from～to（含）之間的扣款日，往前往後都推（給「本月」用，含還沒到的） */
export function chargesBetween(e: Pick<Expense, "kind" | "cycle" | "next_due" | "started_on"> & { active?: boolean }, from: string, to: string): string[] {
  if (e.kind !== "subscription" || !e.cycle || !e.next_due) return [];
  const lower = e.started_on && e.started_on > from ? e.started_on : from;
  const step = e.cycle === "monthly" ? 1 : 12;
  const out: string[] = [];
  for (let n = -240; n <= 240; n++) {
    if (e.active === false && n >= 0) break; // 停用的：下次扣款日起都不會扣
    const d = addMonths(e.next_due, n * step);
    if (d > to) break;
    if (d >= lower) out.push(d);
  }
  return withStartCharge(out, e, from, to);
}

/** 開始訂閱那天就會付第一筆（例如 11/11 訂、下次扣款 12/10，11/11 那筆要算）。
 *  但開始後 20 天內就有週期扣款（例如 10/1 開始、每月 15 號扣），當作第一筆就是 15 號，不重複算 */
function withStartCharge(dates: string[], e: Pick<Expense, "cycle" | "next_due" | "started_on">, from: string, to: string): string[] {
  const started = e.started_on;
  if (!started || !e.next_due || !e.cycle || started < from || started > to || dates.includes(started)) return dates;
  const step = e.cycle === "monthly" ? 1 : 12;
  // 開始日當天或之後的第一個週期扣款日（下次扣款日可能在開始日之前或之後）
  let first = "";
  for (let n = -240; n <= 240; n++) {
    const d = addMonths(e.next_due, n * step);
    if (d >= started) {
      first = d;
      break;
    }
  }
  // 開始後 20 天內（年付 300 天內）就有週期扣款 → 當作那天才是第一筆
  if (!first || daysUntil(first, started) <= (e.cycle === "monthly" ? 20 : 300)) return dates;
  return [started, ...dates].sort();
}

export type BudgetSummary = {
  total: number;
  scheduled: number; // 一次性開銷裡，付款日還沒到的（不算進已花）
  spent: number;
  remaining: number;
  subscriptions: number;
  oneTime: number;
  ai: number;
  months: number; // 起算到今天幾個月（至少 1）
  perMonth: number; // 平均每月花多少
  runway: number | null; // 照目前速度還能撐幾個月；沒在花錢就是 null
};

/** 從起算日到今天的累計支出（台幣）：訂閱照週期推算、一次性看付款日、AI 用量 */
export function budgetSummary(b: Budget, expenses: Expense[], aiUsd: number, today: string, usdTwd: number): BudgetSummary {
  let subscriptions = 0;
  let oneTime = 0;
  let scheduled = 0;
  for (const e of expenses) {
    if (e.kind === "subscription") subscriptions += pastCharges(e, b.start, today).length * toTwd(e.amount, e.currency, usdTwd);
    else if (e.paid_on && e.paid_on > today) scheduled += toTwd(e.amount, e.currency, usdTwd);
    else if (e.paid_on && e.paid_on >= b.start) oneTime += toTwd(e.amount, e.currency, usdTwd);
  }
  const ai = aiUsd * usdTwd;
  const spent = subscriptions + oneTime + ai;
  const months = Math.max(1, daysUntil(today, b.start) / 30.44); // 起算日到今天經過幾個月
  const perMonth = spent / months;
  const remaining = b.total - spent;
  return { total: b.total, scheduled, spent, remaining, subscriptions, oneTime, ai, months, perMonth, runway: perMonth > 0 ? Math.max(0, remaining) / perMonth : null };
}

export function daysUntil(day: string, today: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** 是否該提醒續約：年付前 7 天、月付前 1 天，同一次扣款只提醒一次 */
export function shouldRemind(e: Expense, today: string): boolean {
  if (e.kind !== "subscription" || !e.active || !e.next_due || !e.cycle) return false;
  if (e.reminded_for === e.next_due) return false;
  const left = daysUntil(e.next_due, today);
  return left >= 0 && left <= (e.cycle === "yearly" ? 7 : 1);
}

// ---------- 金額 ----------

export function toTwd(amount: number, currency: Currency, usdTwd: number): number {
  return currency === "USD" ? amount * usdTwd : amount;
}

/** 訂閱換算成每月平均（台幣） */
export function monthlyTwd(e: Expense, usdTwd: number): number {
  if (e.kind !== "subscription" || !e.active) return 0;
  const twd = toTwd(e.amount, e.currency, usdTwd);
  return e.cycle === "yearly" ? twd / 12 : twd;
}

export type MonthSummary = {
  month: string; // YYYY-MM
  subscriptions: number; // 本月真的會扣的訂閱（依扣款日，年付只在扣款那個月）
  subscriptionsPaid: number; // 其中已經扣了的（扣款日 ≤ 今天）
  avgSubscriptions: number; // 訂閱換算每月平均（年付 1/12），只當參考
  oneTime: number; // 本月一次性（含付款日還沒到的）
  oneTimePaid: number; // 其中付款日已到的
  ai: number; // 本月 AI 用量（台幣）
  total: number; // 本月合計（含月底前還會扣的）
  paid: number; // 本月到今天已經花的
  byProduct: Record<Product, number>;
};

/** 本月花費：跟總預算用同一套算法（依實際扣款日／付款日），另外分出「已付」和「月底前還會扣」 */
export function monthSummary(expenses: Expense[], ai: AiUsageRow[], month: string, usdTwd: number, today: string = `${month}-31`): MonthSummary {
  const byProduct: Record<Product, number> = {};
  const add = (p: Product, v: number) => (byProduct[p] = (byProduct[p] ?? 0) + v);
  const monthEnd = `${month}-31`; // 字串比較用，31 號以後就是下個月
  let subscriptions = 0;
  let subscriptionsPaid = 0;
  let avgSubscriptions = 0;
  let oneTime = 0;
  let oneTimePaid = 0;
  let aiTwd = 0;
  for (const e of expenses) {
    const twdAmount = toTwd(e.amount, e.currency, usdTwd);
    if (e.kind === "subscription") {
      avgSubscriptions += monthlyTwd(e, usdTwd);
      for (const d of chargesBetween(e, `${month}-01`, monthEnd)) {
        subscriptions += twdAmount;
        if (d <= today) subscriptionsPaid += twdAmount;
        add(e.product, twdAmount);
      }
    } else if (e.paid_on?.startsWith(month)) {
      oneTime += twdAmount;
      if (e.paid_on <= today) oneTimePaid += twdAmount;
      add(e.product, twdAmount);
    }
  }
  for (const a of ai) {
    if (!taipeiMonth(a.at).startsWith(month)) continue;
    const v = a.usd * usdTwd;
    aiTwd += v;
    add(a.product, v);
  }
  return {
    month,
    subscriptions,
    subscriptionsPaid,
    avgSubscriptions,
    oneTime,
    oneTimePaid,
    ai: aiTwd,
    total: subscriptions + oneTime + aiTwd,
    paid: subscriptionsPaid + oneTimePaid + aiTwd,
    byProduct,
  };
}

/** ISO 時間 → 台北時間的 YYYY-MM */
export function taipeiMonth(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 7);
}

export function twd(n: number): string {
  return `NT$${Math.round(n).toLocaleString("en-US")}`;
}
