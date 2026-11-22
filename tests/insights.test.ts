import { describe, expect, it } from "vitest";
import type { Idea } from "@/lib/db";
import type { Milestone } from "@/lib/projectLogic";
import type { Grant } from "@/lib/db";
import type { Expense } from "@/lib/costCalc";
import { countInRange, focusTodos, groupTodos, grantInsights, ideaInsights, monthCharges, projectDetailInsights, projectInsights, weeklyCounts } from "@/lib/insights";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-17T04:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const idea = (p: Partial<Idea>) =>
  ({ id: "x", source: "text", status: "analyzed", adopted: false, category: null, score_total: null, summary: null, content: null, url: null, created_at: ago(1), ...p }) as Idea;

describe("重點數字", () => {
  it("每週筆數：由舊到新，未來與太舊的不算", () => {
    const w = weeklyCounts([ago(0), ago(6), ago(7), ago(20), ago(100), new Date(NOW + DAY).toISOString(), "亂寫"], NOW, 4);
    expect(w).toEqual([0, 1, 1, 2]);
  });

  it("點子：本週、平均分數、最高分、可能重複", () => {
    const ins = ideaInsights(
      [
        idea({ id: "a", score_total: 9, summary: "最高分", created_at: ago(2) }),
        idea({ id: "b", score_total: 6, adopted: true, created_at: ago(9) }),
        idea({ id: "c", dup_of: "a", created_at: ago(3) }),
        idea({ id: "d", dup_of: "a", dup_dismissed: true, created_at: ago(40) }),
      ],
      NOW,
    );
    expect(ins.week).toBe(2);
    expect(ins.lastWeek).toBe(1);
    expect(ins.adopted).toBe(1);
    expect(ins.avgScore).toBe(7.5);
    expect(ins.top).toEqual({ id: "a", title: "最高分", score: 9 });
    expect(ins.dups).toBe(1);
  });

  it("點子：沒有分數時平均是空的，分類與來源照數量排", () => {
    const ins = ideaInsights([idea({ category: "marketing" }), idea({ category: "marketing", source: "threads" }), idea({ source: "threads" }), idea({ source: "threads" })], NOW);
    expect(ins.avgScore).toBeNull();
    expect(ins.top).toBeNull();
    expect(ins.cats.map((c) => [c.cat, c.n])).toEqual([["marketing", 2], [null, 2]]);
    expect(ins.sources[0]).toEqual({ source: "threads", n: 3 });
  });

  it("點子提醒：只挑分數高、放超過 14 天、還沒採用的", () => {
    const base = [
      idea({ id: "new", score_total: 9, created_at: ago(3) }), // 太新
      idea({ id: "low", score_total: 5, created_at: ago(30) }), // 分數不夠
      idea({ id: "done", score_total: 9, adopted: true, created_at: ago(30) }), // 已採用
    ];
    expect(ideaInsights(base, NOW).nudge).toBeNull();
    const ins = ideaInsights([...base, idea({ id: "old8", score_total: 8, created_at: ago(40) }), idea({ id: "hit", score_total: 9, summary: "該動手了", created_at: ago(20) })], NOW);
    expect(ins.nudge).toEqual({ id: "hit", title: "該動手了", days: 20 });
  });

  it("專案：暫停的專案不算里程碑；過期與接下來分開算", () => {
    const ms = (p: Partial<Milestone>) => ({ id: "m", project_id: "p1", title: "t", due: "2026-11-20", done: false, reminded_7: false, reminded_1: false, ...p }) as Milestone;
    const ins = projectInsights(
      [{ id: "p1", status: "active" }, { id: "p2", status: "paused" }] as never,
      [ms({ id: "late", due: "2026-11-10" }), ms({ id: "far", due: "2026-12-01" }), ms({ id: "near", due: "2026-11-20" }), ms({ id: "done", done: true }), ms({ id: "other", project_id: "p2" })],
      [{ at: ago(1) }, { at: ago(2) }, { at: ago(10) }],
      "2026-11-17",
      NOW,
    );
    expect([ins.active, ins.paused]).toEqual([1, 1]);
    expect([ins.logsWeek, ins.logsLastWeek]).toEqual([2, 1]);
    expect(ins.upcoming.map((m) => [m.id, m.days])).toEqual([["near", 3], ["far", 14]]);
    expect(ins.overdue).toBe(1);
  });

  it("沒日期的待辦：算進還沒做的總數，但不算過期、不算接下來，詳細頁排在有日期的後面", () => {
    const ms = (p: Partial<Milestone>) => ({ id: "m", project_id: "p1", title: "t", due: "2026-11-20", done: false, reminded_7: false, reminded_1: false, ...p }) as Milestone;
    const list = [ms({ id: "a", due: null }), ms({ id: "b", due: "2026-11-25" }), ms({ id: "c", due: "2026-11-01" }), ms({ id: "d", due: null, done: true })];
    const pin = projectInsights([{ id: "p1", status: "active" }], list, [], "2026-11-20", Date.parse("2026-11-20T04:00:00Z"));
    expect(pin).toMatchObject({ open: 3, overdue: 1 });
    expect(pin.upcoming.map((m) => m.id)).toEqual(["b"]);
    const d = projectDetailInsights(list, [], "2026-11-20", Date.parse("2026-11-20T04:00:00Z"));
    expect(d.upcoming.map((m) => `${m.id}:${m.days}`)).toEqual(["c:-19", "b:5", "a:null"]);
    expect(d).toMatchObject({ overdue: 1, msDone: 1, msTotal: 4, next: { title: "t", due: "2026-11-25", days: 5 } });
  });

  it("待辦分組與「現在要注意的」：過期和快到期的排最前面，暫停的專案不算", () => {
    const ms = (p: Partial<Milestone>) => ({ id: "m", project_id: "p1", title: "t", due: "2026-11-20", done: false, reminded_7: false, reminded_1: false, ...p }) as Milestone;
    const list = [ms({ id: "far", due: "2026-12-20" }), ms({ id: "none", due: null }), ms({ id: "week", due: "2026-11-27" }), ms({ id: "late", due: "2026-11-18" }), ms({ id: "soon", due: "2026-11-23" }), ms({ id: "ok", done: true }), ms({ id: "paused", project_id: "p2", due: "2026-11-01" })];
    const g = groupTodos(list.filter((m) => m.project_id === "p1"), "2026-11-20");
    expect(g.urgent.map((m) => m.id)).toEqual(["late", "soon", "week"]);
    expect(g.later.map((m) => m.id)).toEqual(["far"]);
    expect(g.someday.map((m) => m.id)).toEqual(["none"]);
    expect(g.done.map((m) => m.id)).toEqual(["ok"]);
    const f = focusTodos([{ id: "p1", status: "active" }, { id: "p2", status: "paused" }], list, "2026-11-20");
    expect(f.map((m) => `${m.id}:${m.days}`)).toEqual(["late:-2", "soon:3"]);
  });

  it("專案詳細頁：下一個里程碑跳過已完成和過期的，過期的另外算", () => {
    const ms = (p: Partial<Milestone>) => ({ id: "m", project_id: "p1", title: "t", due: "2026-11-20", done: false, reminded_7: false, reminded_1: false, ...p }) as Milestone;
    const ins = projectDetailInsights(
      [ms({ id: "far", title: "上架", due: "2026-12-01" }), ms({ id: "late", due: "2026-11-10" }), ms({ id: "done", due: "2026-11-18", done: true }), ms({ id: "near", title: "送審", due: "2026-11-20" })],
      [{ at: ago(1) }, { at: ago(8) }, { at: ago(9) }],
      "2026-11-17",
      NOW,
    );
    expect(ins.next).toEqual({ title: "送審", due: "2026-11-20", days: 3 });
    expect([ins.overdue, ins.msDone, ins.msTotal]).toEqual([1, 1, 4]);
    expect(ins.upcoming.map((m) => [m.id, m.days])).toEqual([["late", -7], ["near", 3], ["far", 14]]);
    expect([ins.logsWeek, ins.logsLastWeek]).toEqual([1, 2]);
    expect(projectDetailInsights([], [], "2026-11-17", NOW).next).toBeNull();
  });

  it("月曆：跨週的排程兩週都算，範圍外的不算", () => {
    const items = [
      { kind: "event" as const, start: "2026-11-14", end: "2026-11-17" },
      { kind: "event" as const, start: "2026-11-23", end: "2026-11-23" },
      { kind: "milestone" as const, start: "2026-11-20", end: "2026-11-20" },
    ];
    expect(countInRange(items, "2026-11-09", "2026-11-15")).toEqual({ events: 1, milestones: 0 });
    expect(countInRange(items, "2026-11-16", "2026-11-22")).toEqual({ events: 1, milestones: 1 });
    expect(countInRange(items, "2026-11-30", "2026-12-06")).toEqual({ events: 0, milestones: 0 });
  });

  it("補助：已申請、不適合、已截止的不算進截止提醒", () => {
    const g = (p: Partial<Grant>) => ({ id: "g", name: "n", status: "new", deadline: null, fit_score: null, created_at: ago(30), ...p }) as Grant;
    const ins = grantInsights(
      [
        g({ id: "urgent", deadline: "2026-11-19", fit_score: 9, created_at: ago(2) }),
        g({ id: "soon", deadline: "2026-11-28", status: "interested" }),
        g({ id: "applied", deadline: "2026-11-18", status: "applied", fit_score: 8 }),
        g({ id: "ignored", deadline: "2026-11-18", status: "ignored" }),
        g({ id: "closed", deadline: "2026-11-01" }),
        g({ id: "rolling" }),
      ],
      "2026-11-17",
      NOW,
    );
    expect([ins.open, ins.due3, ins.due14, ins.newWeek, ins.highFit]).toEqual([4, 1, 2, 1, 2]);
    expect(ins.timeline.map((t) => [t.id, t.days])).toEqual([["urgent", 2], ["soon", 11]]);
    expect(ins.byStatus).toEqual({ new: 2, interested: 1, applied: 1 });
  });

  it("成本：這個月的扣款照日期排，美元換成台幣，別的月份不算", () => {
    const e = (p: Partial<Expense>) => ({ id: "e", name: "n", product: "shared", kind: "subscription", amount: 100, currency: "TWD", cycle: "monthly", next_due: null, paid_on: null, note: null, active: true, reminded_for: null, created_at: "2026-01-01T00:00:00Z", ...p }) as Expense;
    const list = monthCharges(
      [
        e({ name: "月付", amount: 20, currency: "USD", next_due: "2026-11-20" }),
        e({ name: "年付不在這個月", cycle: "yearly", next_due: "2027-03-05" }),
        e({ name: "一次性", kind: "one_time", cycle: null, amount: 500, paid_on: "2026-11-03" }),
        e({ name: "上個月的一次性", kind: "one_time", cycle: null, paid_on: "2026-10-30" }),
      ],
      "2026-11",
      30,
    );
    expect(list).toEqual([
      { day: "2026-11-03", name: "一次性", twd: 500, kind: "one_time" },
      { day: "2026-11-20", name: "月付", twd: 600, kind: "subscription" },
    ]);
  });
});
