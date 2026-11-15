// 日期顯示（一律台北時間）

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function taipeiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function weekday(day: string): string {
  return WEEK[new Date(`${day}T00:00:00Z`).getUTCDay()];
}

/** 11/20（四） */
export function md(day: string): string {
  return `${+day.slice(5, 7)}/${+day.slice(8, 10)}（${weekday(day)}）`;
}

/** 今天／明天／後天／3 天後／已過 2 天 */
export function relDay(today: string, day: string): string {
  const d = daysBetween(today, day);
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  if (d === 2) return "後天";
  if (d < 0) return `已過 ${-d} 天`;
  return `${d} 天後`;
}

/** 3 分鐘前／2 小時前／5 天前 */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

export function rangeText(start: string, end: string): string {
  return start === end ? md(start) : `${md(start)}～${md(end)}`;
}
