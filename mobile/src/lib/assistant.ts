// 小助手要說什麼：看首頁資料，挑最重要的一句（純函式，方便測試）
import type { AnimName } from "@/components/Sprite";
import { addDays, daysBetween } from "./format";
import type { HomeData } from "./types";

export type Line = { anim: AnimName; text: string };

/** 由重要到不重要排好；點小助手時從第一句開始輪流講 */
export function assistantLines(d: HomeData, nowHm: string): Line[] {
  const lines: Line[] = [];
  const name = new Map(d.projects.map((p) => [p.id, p.name]));

  const down = d.monitor.filter((m) => !m.ok);
  if (down.length) {
    lines.push({ anim: "ponder", text: down.length === 1 ? `${down[0].label} 連不上，我盯著。` : `${down.length} 項服務連不上，第一個是 ${down[0].label}。` });
  }

  const today = d.events.filter((e) => e.start_date <= d.today && e.end_date >= d.today);
  const next = today.filter((e) => e.start_time && e.start_time >= nowHm).sort((a, b) => a.start_time!.localeCompare(b.start_time!))[0];
  if (next) {
    lines.push({ anim: "wave", text: `${next.start_time} ${next.title}，別忘了。` });
  } else if (today.length) {
    lines.push({ anim: "wave", text: `今天有 ${today.length} 個排程，第一個是「${today[0].title}」。` });
  }

  const soon = d.milestones.filter((m) => m.due <= addDays(d.today, 7)).sort((a, b) => a.due.localeCompare(b.due))[0];
  if (soon) {
    const n = daysBetween(d.today, soon.due);
    const when = n <= 0 ? "就是今天" : n === 1 ? "明天" : `還有 ${n} 天`;
    lines.push({ anim: "nod", text: `${name.get(soon.project_id) ?? ""}「${soon.title}」${when}。`.trim() });
  }

  const tomorrow = d.events.filter((e) => e.start_date === addDays(d.today, 1));
  if (tomorrow.length) lines.push({ anim: "think", text: `明天有 ${tomorrow.length} 個排程，第一個是「${tomorrow[0].title}」。` });

  if (!lines.length) lines.push({ anim: "shrug", text: "今天沒有排程，也沒有要趕的事。專心做事吧。" });
  return lines;
}

/** 台北時間的 HH:MM */
export function taipeiHm(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}
