// 產品監控的純邏輯（不連資料庫、可在瀏覽器使用、有單元測試）

/** 產品 key：通用網址監控是 site-<id>，模組提供的產品用自己的 key（例如 myapp） */
export type Product = string;

/** 通用網址監控：一個網址就是一個產品、一個服務 */
export const siteKey = (id: string) => `site-${id}`;

/** 專案短名 → 這個專案對應的監控產品 key（沒有回傳 null） */
export function productForSlug(slug: string, products: { key: string; slugs?: string[] }[]): string | null {
  return products.find((p) => p.key === slug || p.slugs?.includes(slug))?.key ?? null;
}

/** 網址整理：補上 https、去掉結尾斜線；不是 http(s) 網址回傳 null */
export function cleanSiteUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export const DB_WARN_RATIO = 0.8;

/** 連續失敗幾次才算異常（每 5 分鐘一次，2 次 ≈ 10 分鐘內） */
export const FAIL_THRESHOLD = 2;

export type StatusRow = {
  service: string;
  product: Product;
  ok: boolean;
  fail_count: number;
  changed_at: string;
  checked_at: string | null;
  latency_ms: number | null;
  last_error: string | null;
  notified_down: boolean;
  warned_on: string | null;
};

export type CheckResult = { ok: boolean; latencyMs: number; error?: string };

/** 根據這次檢查結果算出新狀態，並判斷要不要通知（掛掉／恢復） */
export function nextStatus(
  prev: StatusRow | null,
  service: string,
  product: Product,
  r: CheckResult,
  nowIso: string,
): { row: StatusRow; event: "down" | "up" | null; downSince?: string } {
  const base: StatusRow = prev ?? {
    service,
    product,
    ok: true,
    fail_count: 0,
    changed_at: nowIso,
    checked_at: null,
    latency_ms: null,
    last_error: null,
    notified_down: false,
    warned_on: null,
  };
  const row: StatusRow = { ...base, product, checked_at: nowIso, latency_ms: r.latencyMs };

  if (r.ok) {
    row.fail_count = 0;
    row.last_error = null;
    const wasDown = !base.ok;
    row.ok = true;
    if (wasDown) row.changed_at = nowIso;
    const event = base.notified_down ? "up" : null;
    row.notified_down = false;
    return { row, event, downSince: wasDown ? base.changed_at : undefined };
  }

  row.fail_count = base.fail_count + 1;
  row.last_error = (r.error ?? "沒有回應").slice(0, 200);
  if (row.fail_count >= FAIL_THRESHOLD && base.ok) {
    row.ok = false;
    // 從第一次失敗開始算（約早一個檢查週期）
    row.changed_at = nowIso;
  }
  if (!row.ok && !base.notified_down) {
    row.notified_down = true;
    return { row, event: "down" };
  }
  return { row, event: null };
}

/** 「12 分鐘」「3 小時 5 分」這種長度描述 */
export function durationText(ms: number, lang: "zh" | "en" = "zh"): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const en = lang === "en";
  if (min < 60) return en ? `${min} min` : `${min} 分鐘`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return en ? (m ? `${h} h ${m} min` : `${h} h`) : m ? `${h} 小時 ${m} 分` : `${h} 小時`;
  const d = Math.floor(h / 24);
  return en ? `${d} d ${h % 24} h` : `${d} 天 ${h % 24} 小時`;
}

export function formatBytes(b: number | null | undefined): string {
  if (b == null) return "—";
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} KB`;
}
