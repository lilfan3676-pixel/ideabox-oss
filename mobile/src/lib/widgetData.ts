// 桌面小工具要顯示的資料（純函式，不碰原生；測試在根目錄 tests/widgetData.test.ts）。
// 小工具自己不能連網，資料是 App 讀到首頁時算好推過去的；所以一次把「今天接下來每個時間點該顯示什麼」都算好排進去，
// App 沒開的時候小工具也會照時間自己換下一件。
import type { AppEvent, HomeData } from "./types";

export type WidgetText = { next: string; nextNone: string; allDone: string; today: string; todayEmpty: string; projects: string; projectsEmpty: string; allDay: string; overdue: (n: number) => string; until: (min: number) => string; noStep: string; lang: "zh" | "en" };

export type NextData = { has: boolean; time: string; title: string; sub: string; done: number; total: number; overdue: number; label: string; overdueText: string };
export type TodayData = { rows: { t: string; title: string; state: "past" | "next" | "later" }[]; done: number; total: number; overdue: number; label: string; empty: string; overdueText: string };
export type ProjectsData = { rows: { name: string; next: string; frac: string; color: string; late: number }[]; label: string; empty: string };

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
/** 有時間的事開始 30 分鐘後算做完（跟 App 裡同一個規則） */
const isPast = (e: AppEvent, nowMin: number) => !!e.start_time && toMin(e.start_time) + 30 <= nowMin;

export function todayEvents(home: HomeData): AppEvent[] {
  return home.events.filter((e) => e.start_date <= home.today && e.end_date >= home.today).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
}

/** 某個時間點（台北時間，當天的第幾分鐘）「下一件」「今天」兩個小工具各自要顯示什麼 */
export function widgetsAt(home: HomeData, nowMin: number, T: WidgetText): { next: NextData; today: TodayData } {
  // 過了午夜（1440）：今天的事都不算了，顯示空的一天，等下次開 App 再換成新的
  const list = nowMin >= 1440 ? [] : todayEvents(home);
  const name = new Map(home.projects.map((p) => [p.id, p.name]));
  const done = list.filter((e) => isPast(e, nowMin)).length;
  const overdue = home.overdue ?? 0;
  const up = list.find((e) => e.start_time && !isPast(e, nowMin)) ?? list.find((e) => !e.start_time);
  const base = { done, total: list.length, overdue, overdueText: overdue > 0 ? T.overdue(overdue) : "" };
  const next: NextData = up
    ? { ...base, has: true, label: T.next, time: up.start_time ?? "", title: up.title, sub: [up.start_time ? T.until(toMin(up.start_time) - nowMin) : T.allDay, name.get(up.project_id)].filter(Boolean).join("・") }
    : { ...base, has: false, label: T.today, time: "", title: list.length ? T.allDone : T.nextNone, sub: "" };
  const today: TodayData = {
    ...base,
    label: T.today,
    empty: T.todayEmpty,
    rows: list.map((e) => ({ t: e.start_time ?? T.allDay, title: e.title, state: isPast(e, nowMin) ? "past" : e.id === up?.id ? "next" : "later" })),
  };
  return { next, today };
}

/** 今天接下來「畫面會變」的時間點（分鐘）：現在、每件事開始 30 分鐘後、以及每小時整點（「還有幾小時」要跟著變） */
export function changePoints(home: HomeData, nowMin: number): number[] {
  const pts = new Set<number>([nowMin]);
  // 開始前一小時內每 10 分鐘換一次（「還有幾分鐘」才不會差太多）、開始、開始 30 分鐘後
  for (const e of todayEvents(home)) if (e.start_time) for (const m of [-60, -50, -40, -30, -20, -10, 0, 30].map((d) => toMin(e.start_time!) + d)) if (m > nowMin && m < 1440) pts.add(m);
  for (let h = Math.floor(nowMin / 60) + 1; h < 24; h++) pts.add(h * 60);
  // 最後一定排午夜那一格（換成空的一天）；中間太多就留最近的
  return [...[...pts].sort((a, b) => a - b).slice(0, 59), 1440];
}

export function projectsData(home: HomeData, colorOf: (id: string) => string, T: WidgetText): ProjectsData {
  return {
    label: T.projects,
    empty: T.projectsEmpty,
    rows: home.projects
      .filter((p) => p.status === "active")
      .slice(0, 6)
      .map((p) => ({ name: p.name, next: p.next_step ?? T.noStep, frac: p.stage_count ? `${p.stage_index + 1}/${p.stage_count}` : "", color: colorOf(p.id), late: home.todo?.[p.id]?.late ?? 0 })),
  };
}
