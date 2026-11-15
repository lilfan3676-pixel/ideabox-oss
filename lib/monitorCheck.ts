import "server-only";
import type { CheckResult } from "./monitorLogic";
import type { MonitorStats } from "./modules/types";

// 監控用的小工具（核心的網址監控與模組都會用）

export const TIMEOUT_MS = 10_000;

/** 計時並把錯誤變成 CheckResult */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; result: CheckResult }> {
  const t = Date.now();
  try {
    const value = await fn();
    return { value, result: { ok: true, latencyMs: Date.now() - t } };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "TimeoutError" ? "逾時（超過 10 秒沒回應）" : err.message) : String(err);
    return { result: { ok: false, latencyMs: Date.now() - t, error: msg } };
  }
}

/** 網站有沒有活著：5xx 或連不上算失敗（404 之類網站本身有回應就算正常） */
export async function checkSite(url: string): Promise<void> {
  const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status >= 500) throw new Error(`網站回應 HTTP ${res.status}`);
}

export function toStats(s: Partial<Record<keyof MonitorStats, unknown>>): MonitorStats {
  return { users: Number(s.users) || 0, active7: Number(s.active7) || 0, new7: Number(s.new7) || 0, db_bytes: Number(s.db_bytes) || 0 };
}
