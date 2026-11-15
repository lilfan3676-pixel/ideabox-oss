import "server-only";
import {
  daysUntil,
  monthSummary,
  productOptions,
  rollDue,
  shouldRemind,
  toTwd,
  twd,
  type AiUsageRow,
  type Expense,
} from "./costCalc";
import { taipeiDate } from "./dates";
import { db } from "./db";
import { esc, sendToOwner } from "./telegram";

const FX_FALLBACK = 32;
export type Fx = { rate: number; day: string | null; fallback: boolean };

/** 美金兌台幣：一天更新一次，抓不到就用上次的值 */
export async function getFx(refresh = false): Promise<Fx> {
  const { data } = await db().from("settings").select("value").eq("key", "fx_usd_twd").maybeSingle();
  let saved: { rate: number; day: string } | null = null;
  try {
    saved = data ? JSON.parse((data as { value: string }).value) : null;
  } catch {
    saved = null;
  }
  const today = taipeiDate();
  if (!refresh && saved?.rate) return { rate: saved.rate, day: saved.day, fallback: false };
  if (saved?.day === today && saved.rate) return { rate: saved.rate, day: saved.day, fallback: false };
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const rate = j.rates?.TWD;
    if (j.result !== "success" || !rate || rate < 20 || rate > 50) throw new Error("匯率資料異常");
    await db().from("settings").upsert({ key: "fx_usd_twd", value: JSON.stringify({ rate, day: today }), updated_at: new Date().toISOString() });
    return { rate, day: today, fallback: false };
  } catch {
    return saved?.rate ? { rate: saved.rate, day: saved.day, fallback: false } : { rate: FX_FALLBACK, day: null, fallback: true };
  }
}

export async function listExpenses(): Promise<Expense[]> {
  const { data, error } = await db().from("expenses").select("*").order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Expense[]).map((e) => ({ ...e, amount: Number(e.amount) }));
}

/** 某個時間之後的 AI 用量（台北時間月份起算由呼叫端決定） */
export async function aiUsageSince(sinceIso: string): Promise<AiUsageRow[]> {
  const { data } = await db().from("ai_usage").select("at,model,purpose,product,usd").gte("at", sinceIso).order("at").limit(20000);
  return ((data ?? []) as AiUsageRow[]).map((r) => ({ ...r, usd: Number(r.usd) }));
}

/** 總預算（settings.budget）；沒設定回傳 null */
/** 總預算金額（settings.budget）；起算日由呼叫端用第一筆成本紀錄決定。沒設定回傳 null */
export async function getBudgetTotal(): Promise<number | null> {
  const { data } = await db().from("settings").select("value").eq("key", "budget").maybeSingle();
  try {
    const b = JSON.parse((data as { value: string } | null)?.value ?? "null") as { total?: number } | null;
    return b && Number.isFinite(b.total) && Number(b.total) > 0 ? Number(b.total) : null;
  } catch {
    return null;
  }
}

/** 起算日之後 AI 用量的美元總和 */
export async function aiUsdSince(day: string): Promise<number> {
  const { data } = await db().from("ai_usage").select("usd").gte("at", new Date(Date.parse(`${day}T00:00:00+08:00`)).toISOString()).limit(100000);
  return ((data ?? []) as { usd: number }[]).reduce((s, r) => s + Number(r.usd), 0);
}

/** 台北時間某月 1 日 00:00 的 ISO 時間 */
export function monthStartIso(month: string): string {
  return new Date(Date.parse(`${month}-01T00:00:00+08:00`)).toISOString();
}

/** 每天：更新匯率、把過期的扣款日往後推、續約前提醒 */
export async function runCostDaily() {
  const today = taipeiDate();
  const fx = await getFx(true);
  const expenses = await listExpenses();
  const nameOf = await productNames().catch(() => (p: string) => p);
  let rolled = 0;
  const reminders: string[] = [];
  for (const e of expenses) {
    if (e.kind !== "subscription" || !e.active || !e.next_due || !e.cycle) continue;
    let due = e.next_due;
    if (due < today) {
      due = rollDue(due, e.cycle, today);
      await db().from("expenses").update({ next_due: due }).eq("id", e.id);
      rolled++;
    }
    const cur = { ...e, next_due: due };
    if (shouldRemind(cur, today)) {
      const left = daysUntil(due, today);
      const when = left === 0 ? "今天" : left === 1 ? "明天" : `${left} 天後（${due.slice(5).replace("-", "/")}）`;
      const money = e.currency === "USD" ? `US$${e.amount}（約 ${twd(toTwd(e.amount, "USD", fx.rate))}）` : twd(e.amount);
      reminders.push(`・${esc(e.name)}（${esc(nameOf(e.product))}）${when}扣款 ${money}${e.cycle === "yearly" ? "・年付" : ""}`);
      await db().from("expenses").update({ reminded_for: due }).eq("id", e.id);
    }
  }
  if (reminders.length) {
    await sendToOwner(["💳 <b>續約提醒</b>", ...reminders, "", "不再使用的話，記得先取消訂閱。"].join("\n")).catch(() => null);
  }
  return { fx: fx.rate, rolled, reminded: reminders.length };
}

/** 產品短名 → 名稱（專案名；共用、ideabox） */
async function productNames(): Promise<(p: string) => string> {
  const { data } = await db().from("projects").select("slug, name");
  const opts = productOptions((data ?? []) as { slug: string; name: string }[]);
  return (p) => opts.find((o) => o.key === p)?.zh ?? p;
}

/** 週報用：本月花費摘要 */
export async function costDigestLines(): Promise<string[]> {
  const month = taipeiDate().slice(0, 7);
  const [expenses, ai, fx] = await Promise.all([listExpenses(), aiUsageSince(monthStartIso(month)), getFx()]);
  if (!expenses.length && !ai.length) return [];
  const s = monthSummary(expenses, ai, month, fx.rate, taipeiDate());
  const nameOf = await productNames().catch(() => (p: string) => p);
  const parts = (Object.keys(s.byProduct) as (keyof typeof s.byProduct)[])
    .filter((p) => s.byProduct[p] >= 1)
    .map((p) => `${esc(nameOf(p))} ${twd(s.byProduct[p])}`);
  return [
    "",
    `💳 <b>本月花費</b> ${twd(s.total)}${s.total - s.paid >= 1 ? `（已付 ${twd(s.paid)}）` : ""}`,
    `訂閱 ${twd(s.subscriptions)}・一次性 ${twd(s.oneTime)}・AI 用量 ${twd(s.ai)}`,
    ...(parts.length ? [parts.join("・")] : []),
  ];
}
