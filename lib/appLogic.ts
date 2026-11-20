// 手機 App 的純邏輯（不碰資料庫，方便測試）：配對碼、憑證雜湊、排程時間、推送內容

import { createHash, randomBytes } from "node:crypto";
export { parseTime } from "./appTime";

/** 配對碼有效時間 */
export const PAIR_TTL_MS = 10 * 60_000;
/** 有填時間的排程，開始前幾分鐘推送 */
export const REMIND_BEFORE_MIN = 30;
/** 開始時間已經過了多久還補推（避免排程剛好落在兩次檢查之間被漏掉；太舊的就不推了） */
export const REMIND_GRACE_MIN = 10;

// 配對碼用不容易看錯的字（沒有 0/O、1/I/L）
const PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newPairCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => PAIR_ALPHABET[b % PAIR_ALPHABET.length]).join("");
}

/** 使用者手打的配對碼：去掉空白與連字號、轉大寫 */
export function normalizePairCode(s: unknown): string {
  return typeof s === "string" ? s.replace(/[\s-]/g, "").toUpperCase() : "";
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** 台北時間的「YYYY-MM-DD HH:MM」換成 epoch 毫秒（台北沒有日光節約，固定 +08:00） */
export function taipeiEpoch(date: string, time: string): number {
  return new Date(`${date}T${time.slice(0, 5)}:00+08:00`).getTime();
}

export type TimedEvent = { id: string; title: string; start_date: string; start_time: string | null; reminded: boolean; project_name?: string };

/** 現在該推送的有時間排程：開始前 30 分鐘內，或剛開始不到 10 分鐘還沒推過的 */
export function dueReminders<T extends TimedEvent>(events: T[], now: number): T[] {
  return events.filter((e) => {
    if (!e.start_time || e.reminded) return false;
    const at = taipeiEpoch(e.start_date, e.start_time);
    return at - now <= REMIND_BEFORE_MIN * 60_000 && now - at <= REMIND_GRACE_MIN * 60_000;
  });
}

/** 推送用的文字：從 Telegram 的 HTML 拿掉標籤、還原跳脫字元 */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
}

export type PushMessage = { title: string; body: string; data?: Record<string, string> };

/** 早上的「今天的排程」：單日與多天的都算（多天的只在第一天提） */
export function todayEventsPush(events: { title: string; start_date: string; end_date: string; start_time: string | null; project_name?: string }[], today: string): PushMessage | null {
  const list = events
    .filter((e) => e.start_date === today)
    .sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  if (!list.length) return null;
  const lines = list.map((e) => {
    const when = e.start_time ? `${e.start_time.slice(0, 5)} ` : "";
    const who = e.project_name ? `［${e.project_name}］` : "";
    const range = e.end_date > e.start_date ? `（到 ${e.end_date.slice(5).replace("-", "/")}）` : "";
    return `${when}${who}${e.title}${range}`;
  });
  return { title: `🗓 今天有 ${list.length} 個排程`, body: lines.join("\n"), data: { screen: "today" } };
}

// ---------- 主題（網頁選的主題同步給 App） ----------

export const UI_THEMES = ["fluento", "ember", "portal", "mono"] as const;
export type UiTheme = (typeof UI_THEMES)[number];
export type UiMode = "light" | "dark";

/** settings.ui_theme 存「portal:dark」；讀不懂就用預設 fluento 淺色 */
export function parseUiTheme(v: unknown): { theme: UiTheme; mode: UiMode } {
  const [t, m] = String(v ?? "").split(":");
  return {
    theme: (UI_THEMES as readonly string[]).includes(t) ? (t as UiTheme) : "fluento",
    mode: m === "dark" ? "dark" : "light",
  };
}

/** 網頁傳來的值檢查過才存；不合法回 null */
export function uiThemeValue(theme: unknown, mode: unknown): string | null {
  if (!(UI_THEMES as readonly string[]).includes(String(theme))) return null;
  if (mode !== "light" && mode !== "dark") return null;
  return `${theme}:${mode}`;
}
