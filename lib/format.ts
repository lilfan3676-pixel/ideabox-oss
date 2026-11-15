// 顯示用的格式化函式（前後端共用）
/** 「3 天前」「2 個月前」這類相對時間 */
export function timeAgo(iso: string | null | undefined, now = Date.now(), lang: "zh" | "en" = "zh"): string {
  if (!iso) return "";
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (lang === "en") {
    if (days < 1) return "today";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }
  if (days < 1) return "今天";
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export function formatStars(n: number | undefined): string {
  if (n === undefined) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** 台北時間的「10/30 22:05」或「10/30」。手動計算，伺服器與瀏覽器結果一定相同（避免畫面閃動錯誤） */
export function taipeiShort(iso: string, withTime = true): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  if (!withTime) return md;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${md} ${hh}:${mm}`;
}
