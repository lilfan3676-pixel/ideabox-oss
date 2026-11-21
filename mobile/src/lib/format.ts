// 日期顯示（一律台北時間）

import { L, lang } from "./i18n";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 有時間的事開始 30 分鐘後算做完（今天頁、月曆共用） */
export const pastBy = (start: string | null | undefined, nowHm: string) => !!start && +start.slice(0, 2) * 60 + +start.slice(3, 5) + 30 <= +nowHm.slice(0, 2) * 60 + +nowHm.slice(3, 5);

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
  return (lang() === "en" ? WEEK_EN : WEEK)[new Date(`${day}T00:00:00Z`).getUTCDay()];
}

/** 11/20 */
export const mdShort = (day: string) => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;

/** 11/20 週四 ／ 11/20 Thu */
export function md(day: string): string {
  return `${mdShort(day)} ${L("週", "")}${weekday(day)}`;
}

/** 今天／明天／3 天後／已過 2 天 */
export function relDay(today: string, day: string): string {
  const d = daysBetween(today, day);
  if (d === 0) return L("今天", "Today");
  if (d === 1) return L("明天", "Tomorrow");
  if (d < 0) return L(`已過 ${-d} 天`, `${-d}d late`);
  return L(`${d} 天後`, `in ${d}d`);
}

/** 3 分鐘前／2 小時前／5 天前 */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return L("剛剛", "just now");
  if (m < 60) return L(`${m} 分鐘前`, `${m}m ago`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`${h} 小時前`, `${h}h ago`);
  return L(`${Math.round(h / 24)} 天前`, `${Math.round(h / 24)}d ago`);
}

export function rangeText(start: string, end: string): string {
  return start === end ? md(start) : `${md(start)}～${md(end)}`;
}

/** 台北時間的 HH:MM */
export function taipeiHm(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}
