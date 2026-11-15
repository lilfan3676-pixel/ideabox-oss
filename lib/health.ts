import "server-only";
import { modules } from "./modules/registry";
import { PURPOSE_LABEL, PURPOSE_LABEL_EN } from "./costCalc";
import { db } from "./db";
import { env } from "./env";
import {
  checkAnalysis,
  checkCost,
  checkErrors,
  checkSchedules,
  checkTelegram,
  healthMessage,
  sortIssues,
  type HealthReport,
  type SysEvent,
  type WebhookInput,
} from "./healthLogic";
import { esc, getWebhookInfo, sendToOwner } from "./telegram";

const KEY = "health_report";
const DAY = 86_400_000;

export async function readHealth(): Promise<HealthReport | null> {
  const { data } = await db().from("settings").select("value").eq("key", KEY).maybeSingle();
  if (!data) return null;
  try {
    return JSON.parse((data as { value: string }).value) as HealthReport;
  } catch {
    return null;
  }
}

// Supabase 一次查詢最多回 1000 筆（limit 寫再大也一樣），一週的監控＋Slack 紀錄有好幾千筆，
// 只讀一次會只拿到最舊的 1000 筆 → 誤判後面幾天的排程都沒跑。所以分頁讀到完。
const PAGE = 1000;
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, max = 50_000): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error: out.length ? null : error };
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

/** 做一次健康檢查並存起來。notify=true 時有問題才傳 Telegram。 */
export async function runHealthCheck({ notify }: { notify: boolean }): Promise<HealthReport> {
  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY).toISOString();

  // 系統紀錄（沒執行 migration-008 時會是空的，排程檢查就略過）
  const [{ data: evData, error: evErr }, { data: first }] = await Promise.all([
    allRows<SysEvent>((from, to) => db().from("sys_events").select("at,kind,source,ok,detail").gte("at", weekAgo).order("at").range(from, to)),
    db().from("sys_events").select("at").order("at").limit(1),
  ]);
  const events = (evErr ? [] : (evData ?? [])) as SysEvent[];
  const since = first?.[0] ? +new Date((first[0] as { at: string }).at) : now;

  // 點子分析：放棄重試的、卡住超過一天的
  const dayAgo = new Date(now - DAY).toISOString();
  const [{ count: gaveUp }, { count: stuck }] = await Promise.all([
    db().from("ideas").select("id", { count: "exact", head: true }).eq("status", "failed").gte("analyze_attempts", 3),
    db().from("ideas").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", dayAgo),
  ]);

  // AI 費用：這週 vs 前 4 週平均（資料不滿兩週就沒有比較基準）
  const { data: usage } = await allRows((from, to) => db().from("ai_usage").select("at,purpose,usd").gte("at", new Date(now - 35 * DAY).toISOString()).order("at").range(from, to));
  const rows = (usage ?? []) as Array<{ at: string; purpose: string; usd: number | string }>;
  const { data: firstUse } = await db().from("ai_usage").select("at").order("at").limit(1);
  const usageSince = firstUse?.[0] ? +new Date((firstUse[0] as { at: string }).at) : now;
  let week = 0;
  let prev = 0;
  const byPurpose = new Map<string, number>();
  for (const r of rows) {
    const t = +new Date(r.at);
    const usd = Number(r.usd) || 0;
    if (t >= now - 7 * DAY) {
      week += usd;
      byPurpose.set(r.purpose, (byPurpose.get(r.purpose) ?? 0) + usd);
    } else prev += usd;
  }
  const prevWeeks = Math.min(4, Math.floor((now - 7 * DAY - usageSince) / (7 * DAY)));
  const baseline = prevWeeks >= 1 ? prev / prevWeeks : null;
  const top = [...byPurpose.entries()].sort((a, b) => b[1] - a[1])[0];
  const topPurpose = top && top[1] > 0 ? { zh: PURPOSE_LABEL[top[0]] ?? top[0], en: PURPOSE_LABEL_EN[top[0]] ?? top[0], usd: top[1] } : null;

  const hook = (await getWebhookInfo().catch(() => null)) as WebhookInput;

  // 模組自己的檢查（例如自己的排程有沒有跑）
  const extra = (await Promise.all(modules().map((m) => (m.health ? m.health({ events, now, since }).catch(() => []) : Promise.resolve([]))))).flat();

  const issues = sortIssues([
    ...checkSchedules(events, now, since),
    ...checkAnalysis({ gaveUp: gaveUp ?? 0, stuck: stuck ?? 0 }),
    ...extra,
    ...checkCost({ weekUsd: week, baselineUsd: baseline, topPurpose }),
    ...checkTelegram(hook, now),
    ...checkErrors(events),
  ]);

  const runs: Record<string, number> = {};
  for (const e of events) if (e.kind === "run") runs[e.source] = (runs[e.source] ?? 0) + 1;
  const report: HealthReport = {
    at: new Date(now).toISOString(),
    issues,
    stats: {
      days: Math.max(0, Math.min(7, Math.round(((now - Math.max(now - 7 * DAY, since)) / DAY) * 10) / 10)),
      runs,
      errors: events.filter((e) => e.kind === "error").length,
      aiUsdWeek: Math.round(week * 100) / 100,
      aiUsdBaseline: baseline == null ? null : Math.round(baseline * 100) / 100,
      aiTopPurpose: topPurpose?.zh ?? null,
    },
  };
  await db().from("settings").upsert({ key: KEY, value: JSON.stringify(report), updated_at: report.at });

  // 系統紀錄只留 60 天
  await db().from("sys_events").delete().lt("at", new Date(now - 60 * DAY).toISOString());

  if (notify && issues.length) await sendToOwner(healthMessage(issues, env.appUrl(), esc));
  return report;
}
