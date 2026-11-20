// 小助手要說什麼：看首頁資料，挑最重要的幾句（純函式；原本在手機 App，2026-11-20 搬到網站）
import { addDays, daysBetween } from "./dates";

export type AssistantAnim = "idle" | "wave" | "nod" | "think" | "ponder" | "shrug";
export type AssistantLine = { anim: AssistantAnim; text: string; href?: string };

type Data = {
  today: string;
  projects: { id: string; name: string }[];
  events: { project_id: string; title: string; start_date: string; end_date: string; start_time: string | null }[];
  milestones: { project_id: string; title: string; due: string }[];
  monitor: { label: string; ok: boolean }[];
};

/** 由重要到不重要排好；點小助手時從第一句開始輪流講。lang＝介面語言 */
export function assistantLines(d: Data, nowHm: string, lang: "zh" | "en" = "zh"): AssistantLine[] {
  const L = (zh: string, en: string) => (lang === "en" ? en : zh);
  const lines: AssistantLine[] = [];
  const name = new Map(d.projects.map((p) => [p.id, p.name]));
  const cal = "/projects?view=calendar";

  const down = d.monitor.filter((m) => !m.ok);
  if (down.length) {
    lines.push({
      anim: "ponder",
      href: "/monitor",
      text: down.length === 1 ? L(`${down[0].label} 連不上，我盯著。`, `${down[0].label} is down. I'm watching it.`) : L(`${down.length} 項服務連不上，第一個是 ${down[0].label}。`, `${down.length} services are down, starting with ${down[0].label}.`),
    });
  }

  const today = d.events.filter((e) => e.start_date <= d.today && e.end_date >= d.today);
  const next = today.filter((e) => e.start_time && e.start_time >= nowHm).sort((a, b) => a.start_time!.localeCompare(b.start_time!))[0];
  if (next) lines.push({ anim: "wave", href: cal, text: L(`${next.start_time} ${next.title}，別忘了。`, `${next.start_time} ${next.title}. Don't forget.`) });
  else if (today.length) lines.push({ anim: "wave", href: cal, text: L(`今天有 ${today.length} 個排程，第一個是「${today[0].title}」。`, `${today.length} things scheduled today, starting with "${today[0].title}".`) });

  const soon = d.milestones.filter((m) => m.due <= addDays(d.today, 7)).sort((a, b) => a.due.localeCompare(b.due))[0];
  if (soon) {
    const n = daysBetween(d.today, soon.due);
    const when = n <= 0 ? L("就是今天", "is due today") : n === 1 ? L("明天", "is due tomorrow") : L(`還有 ${n} 天`, `is due in ${n} days`);
    const who = name.get(soon.project_id) ?? "";
    lines.push({ anim: "nod", href: cal, text: L(`${who}「${soon.title}」${when}。`, `${who} "${soon.title}" ${when}.`).trim() });
  }

  const tomorrow = d.events.filter((e) => e.start_date === addDays(d.today, 1));
  if (tomorrow.length) lines.push({ anim: "think", href: cal, text: L(`明天有 ${tomorrow.length} 個排程，第一個是「${tomorrow[0].title}」。`, `${tomorrow.length} things scheduled tomorrow, starting with "${tomorrow[0].title}".`) });

  if (!lines.length) lines.push({ anim: "shrug", text: L("今天沒有排程，也沒有要趕的事。專心做事吧。", "Nothing scheduled and nothing due. Go do deep work.") });
  return lines;
}
