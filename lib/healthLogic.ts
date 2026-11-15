// 每週健康檢查的判斷邏輯（純函式，方便測試）。所有時間以台北時間（UTC+8，無日光節約）計算。
import { MODULE_SOURCE_LABEL } from "./modules/labels";

export type Level = "error" | "warn";
export type Area = "schedule" | "analysis" | "cost" | "telegram" | "errors";
export type Issue = { level: Level; area: Area; zh: string; en: string };

export type SysEvent = { at: string; kind: "run" | "error"; source: string; ok: boolean; detail: string | null };

export type HealthReport = {
  at: string;
  issues: Issue[];
  stats: {
    days: number; // 這次檢查涵蓋的天數（剛開始記錄時會少於 7）
    runs: Record<string, number>;
    errors: number;
    aiUsdWeek: number;
    aiUsdBaseline: number | null;
    aiTopPurpose: string | null;
  };
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TPE = 8 * HOUR;

export const SOURCE_LABEL: Record<string, [string, string]> = {
  monitor: ["產品監控", "Product monitor"],
  daily: ["每日排程", "Daily job"],
  weekly_digest: ["週報", "Weekly digest"],
  health: ["健康檢查", "Health check"],
  idea_analysis: ["點子分析", "Idea analysis"],
  telegram: ["Telegram 機器人", "Telegram bot"],
  learning: ["自我學習", "Self-learning"],
  slack: ["Slack 進度回報", "Slack progress sync"],
  office: ["辦公室回報", "Office updates"],
  projects: ["專案每日提醒", "Project daily digest"],
  radar: ["話題雷達", "Topic radar"],
  ...MODULE_SOURCE_LABEL,
};
const label = (s: string, lang: 0 | 1) => SOURCE_LABEL[s]?.[lang] ?? s;

/** 台北時間某天（YYYY-MM-DD）的 hh:mm 對應的 UTC 毫秒 */
export function tpeAt(day: string, hh: number, mm = 0): number {
  return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hh, mm) - TPE;
}
export function tpeDay(ms: number): string {
  return new Date(ms + TPE).toISOString().slice(0, 10);
}
export function tpeWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}
export const md = (day: string) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;

/** 範圍內每一個台北日期 */
export function daysIn(from: number, to: number): string[] {
  const out: string[] = [];
  for (let d = tpeDay(from); tpeAt(d, 0) <= to; d = tpeDay(tpeAt(d, 0) + DAY + HOUR)) out.push(d);
  return out;
}

function dur(ms: number, lang: 0 | 1): string {
  const h = Math.round(ms / HOUR);
  if (h < 1) return lang ? `${Math.round(ms / MIN)} min` : `${Math.round(ms / MIN)} 分鐘`;
  if (h < 48) return lang ? `${h} h` : `${h} 小時`;
  return lang ? `${Math.round(h / 24)} days` : `${Math.round(h / 24)} 天`;
}

export const issue = (level: Level, area: Area, zh: string, en: string): Issue => ({ level, area, zh, en });

/**
 * 排程有沒有準時執行。
 * since：開始有紀錄的時間（剛執行 migration 時不到 7 天，就只檢查有紀錄的這段）。
 */
export function checkSchedules(events: SysEvent[], now: number, since: number): Issue[] {
  const start = Math.max(now - 7 * DAY, since);
  const span = now - start;
  if (span < 6 * HOUR) return []; // 紀錄太少，下次再看
  const runs = (src: string) => events.filter((e) => e.kind === "run" && e.source === src && +new Date(e.at) >= start);
  const out: Issue[] = [];

  // 1. 產品監控：每 5 分鐘一次
  const mon = runs("monitor");
  const expected = Math.floor(span / (5 * MIN));
  const last = mon.reduce((a, e) => Math.max(a, +new Date(e.at)), 0);
  if (!last || now - last > 20 * MIN) {
    const gap = last ? now - last : span;
    out.push(issue("error", "schedule", `產品監控已經 ${dur(gap, 0)} 沒有執行，5 分鐘排程可能停了`, `Product monitor hasn't run for ${dur(gap, 1)}; the 5-minute schedule may have stopped`));
  } else if (mon.length < expected * 0.8) {
    out.push(issue("warn", "schedule", `產品監控漏跑：這段時間應執行約 ${expected} 次，實際 ${mon.length} 次`, `Product monitor missed runs: expected about ${expected}, got ${mon.length}`));
  }
  const monFail = mon.filter((e) => !e.ok);
  if (monFail.length >= 3) {
    const d = monFail[monFail.length - 1].detail;
    out.push(issue("warn", "schedule", `產品監控執行失敗 ${monFail.length} 次${d ? `（最近：${d.slice(0, 80)}）` : ""}`, `Product monitor failed ${monFail.length} times${d ? ` (latest: ${d.slice(0, 80)})` : ""}`));
  }

  // 2. 每日排程：台北 21:00（Vercel Cron，可能延遲到該小時內任何時間）＋週日週報
  const daily = runs("daily");
  const digest = runs("weekly_digest");
  const dMissing: string[] = [];
  const dFailed: Array<{ day: string; detail: string | null }> = [];
  for (const d of daysIn(start, now)) {
    if (tpeAt(d, 21) < start || tpeAt(d, 22, 30) > now) continue;
    const that = daily.filter((e) => +new Date(e.at) >= tpeAt(d, 20, 55) && +new Date(e.at) <= tpeAt(d, 23, 59));
    if (!that.length) dMissing.push(d);
    else if (!that.some((e) => e.ok)) dFailed.push({ day: d, detail: that[that.length - 1].detail });
    if (tpeWeekday(d) === 0 && that.length) {
      const sent = digest.some((e) => e.ok && tpeDay(+new Date(e.at)) === d);
      if (!sent) out.push(issue("warn", "schedule", `${md(d)} 的週報沒有成功送出`, `The weekly digest for ${md(d)} wasn't sent`));
    }
  }
  if (dMissing.length) out.push(issue("warn", "schedule", `每日排程沒有執行：${dMissing.map(md).join("、")}`, `Daily job didn't run on ${dMissing.map(md).join(", ")}`));
  for (const f of dFailed) {
    out.push(issue("warn", "schedule", `${md(f.day)} 每日排程有部分工作失敗${f.detail ? `：${f.detail.slice(0, 100)}` : ""}`, `Part of the daily job failed on ${md(f.day)}${f.detail ? `: ${f.detail.slice(0, 100)}` : ""}`));
  }
  return out;
}

export type AnalysisInput = {
  gaveUp: number; // 分析失敗且重試 3 次已停止
  stuck: number; // 超過一天仍在「分析中」
};

export function checkAnalysis(a: AnalysisInput): Issue[] {
  const out: Issue[] = [];
  if (a.gaveUp) out.push(issue("warn", "analysis", `${a.gaveUp} 則點子分析失敗 3 次、已停止重試，到點子庫補充內容或按重新分析`, `${a.gaveUp} idea(s) failed analysis 3 times and won't retry; add details or re-analyze them in Ideas`));
  if (a.stuck) out.push(issue("warn", "analysis", `${a.stuck} 則點子卡在「分析中」超過一天`, `${a.stuck} idea(s) stuck in "analyzing" for over a day`));
  return out;
}

export type CostInput = { weekUsd: number; baselineUsd: number | null; topPurpose: { zh: string; en: string; usd: number } | null };

/** 這週 AI 費用比前幾週平均高 50% 以上、且多出至少 0.5 美元才提醒；還沒有比較基準時超過 5 美元才提醒 */
export function checkCost(c: CostInput): Issue[] {
  const top = c.topPurpose;
  const topZh = top ? `，用最多的是「${top.zh}」$${top.usd.toFixed(2)}` : "";
  const topEn = top ? `; most spent on ${top.en} ($${top.usd.toFixed(2)})` : "";
  if (c.baselineUsd != null) {
    if (c.weekUsd > c.baselineUsd * 1.5 && c.weekUsd - c.baselineUsd >= 0.5) {
      const pct = c.baselineUsd > 0 ? Math.round((c.weekUsd / c.baselineUsd - 1) * 100) : null;
      return [issue("warn", "cost",
        `這週 AI 費用 $${c.weekUsd.toFixed(2)}，比平常每週 $${c.baselineUsd.toFixed(2)} 高${pct != null ? ` ${pct}%` : "很多"}${topZh}`,
        `AI cost this week is $${c.weekUsd.toFixed(2)}, ${pct != null ? `${pct}% ` : "far "}above the usual $${c.baselineUsd.toFixed(2)}/week${topEn}`)];
    }
  } else if (c.weekUsd > 5) {
    return [issue("warn", "cost", `這週 AI 費用 $${c.weekUsd.toFixed(2)}${topZh}`, `AI cost this week is $${c.weekUsd.toFixed(2)}${topEn}`)];
  }
  return [];
}

export type WebhookInput = { url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string } | null;

export function checkTelegram(h: WebhookInput, now: number): Issue[] {
  if (!h) return [issue("warn", "telegram", "讀不到 Telegram 機器人的狀態，Bot Token 可能失效", "Couldn't read the Telegram bot status; the bot token may be invalid")];
  if (!h.url) return [issue("error", "telegram", "Telegram 機器人沒有連上網站（Webhook 未設定），傳訊息給它不會有反應", "The Telegram bot isn't connected (no webhook), so it won't respond to messages")];
  const out: Issue[] = [];
  if (h.last_error_date && now - h.last_error_date * 1000 < 7 * DAY) {
    const m = h.last_error_message?.slice(0, 100) ?? "";
    out.push(issue("warn", "telegram", `Telegram 這週有傳送失敗${m ? `：${m}` : ""}`, `Telegram had delivery errors this week${m ? `: ${m}` : ""}`));
  }
  if (h.pending_update_count >= 5) {
    out.push(issue("warn", "telegram", `Telegram 有 ${h.pending_update_count} 則訊息還沒處理`, `${h.pending_update_count} Telegram messages are waiting to be processed`));
  }
  return out;
}

export function checkErrors(events: SysEvent[]): Issue[] {
  const errs = events.filter((e) => e.kind === "error");
  if (!errs.length) return [];
  const by = new Map<string, number>();
  for (const e of errs) by.set(e.source, (by.get(e.source) ?? 0) + 1);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const latest = errs.reduce((a, e) => (e.at > a.at ? e : a));
  const d = latest.detail?.slice(0, 100) ?? "";
  return [issue(errs.length >= 10 ? "error" : "warn", "errors",
    `網站這週記錄到 ${errs.length} 次錯誤：${parts.map(([s, n]) => `${label(s, 0)} ${n}`).join("、")}${d ? `。最近一次：${d}` : ""}`,
    `${errs.length} error${errs.length > 1 ? "s" : ""} logged this week: ${parts.map(([s, n]) => `${label(s, 1)} ${n}`).join(", ")}${d ? `. Latest: ${d}` : ""}`)];
}

/** 依嚴重程度排序（error 在前） */
export function sortIssues(list: Issue[]): Issue[] {
  return [...list].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** Telegram 訊息（HTML），只在有問題時傳 */
export function healthMessage(issues: Issue[], appUrl: string | null, esc: (s: string) => string): string {
  const lines = [`🩺 <b>ideabox 每週健康檢查</b>：發現 ${issues.length} 個問題`, ""];
  for (const i of issues) lines.push(`${i.level === "error" ? "🔴" : "🟡"} ${esc(i.zh)}`);
  if (appUrl) lines.push("", `詳細狀況：${esc(appUrl.replace(/\/+$/, ""))}/monitor`);
  return lines.join("\n");
}
