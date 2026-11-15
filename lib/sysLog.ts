import "server-only";
import { db } from "./db";

// 系統紀錄（sys_events）：排程執行結果與網站錯誤，給每週健康檢查用。
// 寫入失敗（例如還沒執行 migration-008）一律忽略，不影響原本的功能。

export async function logRun(source: string, ok: boolean, detail?: string | null, ms?: number) {
  try {
    await db().from("sys_events").insert({
      kind: "run",
      source,
      ok,
      detail: detail ? detail.slice(0, 500) : null,
      ms: ms == null ? null : Math.round(ms),
    });
  } catch {
    // 忽略
  }
}

export async function logError(source: string, err: unknown) {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    await db().from("sys_events").insert({ kind: "error", source, ok: false, detail: msg.slice(0, 500) });
  } catch {
    // 忽略
  }
}

/** 執行排程工作並記錄結果；錯誤照樣往外丟 */
export async function track<T>(source: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await logRun(source, true, null, Date.now() - t0);
    return r;
  } catch (err) {
    await logRun(source, false, err instanceof Error ? err.message : String(err), Date.now() - t0);
    throw err;
  }
}
