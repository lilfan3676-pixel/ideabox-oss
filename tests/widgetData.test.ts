// 手機桌面小工具要顯示的資料：下一件、今天的時間軸、各專案的下一步
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformWithOxc } from "vite";
import { describe, expect, it } from "vitest";

// 跟 gesture.test.ts 一樣：mobile/ 是另一個套件，讀原始碼、去掉型別再執行
type Mod = typeof import("../mobile/src/lib/widgetData");
const src = readFileSync(join(__dirname, "../mobile/src/lib/widgetData.ts"), "utf8");
const js = (await transformWithOxc(src, join(__dirname, "widgetData.virtual.ts"))).code.replace(/^export /gm, "").replace(/^import .*$/gm, "");
const { widgetsAt, changePoints, projectsData } = new Function(`${js}\nreturn { widgetsAt, changePoints, projectsData };`)() as Mod;

const T = {
  lang: "zh" as const, next: "下一件", nextNone: "今天沒有排程", allDone: "今天的事都過了", today: "今天", todayEmpty: "今天沒有排程", projects: "各專案的下一步", projectsEmpty: "沒有專案", allDay: "整天", noStep: "還沒寫下一步",
  overdue: (n: number) => `${n} 件待辦過期`,
  until: (m: number) => (m <= 0 ? "進行中" : m < 60 ? `還有 ${m} 分鐘` : `還有 ${Math.round(m / 60)} 小時`),
};
const ev = (id: string, time: string | null, title: string, project = "p1") => ({ id, project_id: project, title, start_date: "2026-11-22", end_date: "2026-11-22", start_time: time });
const proj = (id: string, name: string, over: object = {}) => ({ id, slug: id, name, status: "active" as const, stage: "開發", stage_index: 1, stage_count: 4, next_step: "寫測試", last_activity_at: "2026-11-22T00:00:00Z", ...over });
const home = (over: object = {}) => ({
  today: "2026-11-22",
  overdue: 3,
  todo: { p1: { open: 5, late: 2, week: 1 } },
  projects: [proj("p1", "Fit"), proj("p2", "Cafe", { next_step: null, stage_count: 0 }), proj("p3", "Old", { status: "paused" })],
  events: [ev("a", "10:00", "寫企劃書"), ev("b", "14:00", "發短片", "p2"), ev("c", "20:30", "開會"), { ...ev("x", "09:00", "明天的事"), start_date: "2026-11-23", end_date: "2026-11-23" }],
  milestones: [],
  monitor: [],
  ...over,
});
const min = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

describe("桌面小工具的資料", () => {
  it("下一件：還沒過的第一件；開始 30 分鐘後才算過，接著換下一件", () => {
    const h = home() as never;
    expect(widgetsAt(h, min("09:00"), T).next).toMatchObject({ has: true, time: "10:00", title: "寫企劃書", sub: "還有 1 小時・Fit", done: 0, total: 3, overdue: 3, overdueText: "3 件待辦過期" });
    expect(widgetsAt(h, min("10:20"), T).next).toMatchObject({ time: "10:00", sub: "進行中・Fit", done: 0 });
    expect(widgetsAt(h, min("10:30"), T).next).toMatchObject({ time: "14:00", title: "發短片", sub: "還有 4 小時・Cafe", done: 1 });
    expect(widgetsAt(h, min("20:10"), T).next).toMatchObject({ time: "20:30", sub: "還有 20 分鐘・Fit", done: 2 });
  });

  it("今天的事都過了、今天沒有事、只有整天的事", () => {
    expect(widgetsAt(home() as never, min("21:00"), T).next).toMatchObject({ has: false, title: "今天的事都過了", time: "", done: 3, total: 3 });
    expect(widgetsAt(home({ events: [], overdue: 0 }) as never, 600, T).next).toMatchObject({ has: false, title: "今天沒有排程", overdueText: "" });
    expect(widgetsAt(home({ events: [ev("d", null, "封測第二輪")] }) as never, 600, T).next).toMatchObject({ has: true, time: "", title: "封測第二輪", sub: "整天・Fit" });
  });

  it("今天的時間軸：每一列標出過了／下一件／待會；不含別天的事", () => {
    const rows = widgetsAt(home() as never, min("11:00"), T).today.rows;
    expect(rows).toEqual([
      { t: "10:00", title: "寫企劃書", state: "past" },
      { t: "14:00", title: "發短片", state: "next" },
      { t: "20:30", title: "開會", state: "later" },
    ]);
  });

  it("會變的時間點：現在、每件事前後、每小時整點；只排今天、由早到晚", () => {
    const pts = changePoints(home() as never, min("13:10"));
    expect(pts[0]).toBe(min("13:10"));
    expect(pts).toContain(min("13:30")); // 14:00 那件的前 30 分
    expect(pts).toContain(min("14:30")); // 14:00 那件算做完的時間
    expect(pts).toContain(min("21:00"));
    expect(pts).not.toContain(min("10:30")); // 已經過去的不排
    expect([...pts].sort((a, b) => a - b)).toEqual(pts);
    expect(pts).toContain(min("13:50")); // 開始前一小時內每 10 分鐘換一次
    expect(pts.at(-1)).toBe(1440); // 最後一格是午夜
    expect(pts.length).toBeLessThanOrEqual(60);
  });

  it("過了午夜：顯示空的一天，不留昨天的事", () => {
    const { next, today } = widgetsAt(home() as never, 1440, T);
    expect(next.has).toBe(false);
    expect(today.rows).toEqual([]);
    expect(today.total).toBe(0);
  });

  it("各專案的下一步：只列進行中的，帶顏色、第幾階段與過期幾件", () => {
    const d = projectsData(home() as never, (id) => `#${id}`, T);
    expect(d.rows).toEqual([
      { name: "Fit", next: "寫測試", frac: "2/4", color: "#p1", late: 2 },
      { name: "Cafe", next: "還沒寫下一步", frac: "", color: "#p2", late: 0 },
    ]);
  });
});
