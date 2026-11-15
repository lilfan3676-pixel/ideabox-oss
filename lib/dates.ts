// 以台北時間計算日期（伺服器在 UTC，直接用 new Date() 會差 8 小時）

const TZ = "Asia/Taipei";

/** 回傳台北時間的 YYYY-MM-DD */
export function taipeiDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** 台北時間星期幾，0=星期日 */
export function taipeiWeekday(d: Date = new Date()): number {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(w);
}

/** 兩個 YYYY-MM-DD 相差幾天（to - from） */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type ReminderKind = "14" | "3" | null;

/** 依截止日與已提醒狀態，決定今天要不要提醒、提醒哪一種。 */
export function reminderFor(
  today: string,
  deadline: string | null,
  reminded14: boolean,
  reminded3: boolean,
): ReminderKind {
  if (!deadline) return null;
  const days = daysBetween(today, deadline);
  if (days < 0) return null;
  if (days <= 3) return reminded3 ? null : "3";
  if (days <= 14) return reminded14 ? null : "14";
  return null;
}
