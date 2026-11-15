import { describe, expect, it } from "vitest";
import type { Idea } from "@/lib/db";
import { hasFilters, matchFilters, parseFilters, splitAdopted } from "@/lib/ideaFilters";

const idea = (p: Partial<Idea>) => ({ id: "x", adopted: false, project_id: null, score_total: null, category: null, ...p }) as Idea;
const none = parseFilters({});

describe("點子庫篩選", () => {
  it("網址參數：不認得的值當作沒篩選", () => {
    expect(parseFilters({ adopt: "maybe", min: "5", cat: "hack" })).toEqual(none);
    expect(parseFilters({ adopt: "yes", min: "7", cat: "marketing", project: "p1" })).toEqual({ adopt: "yes", min: 7, cat: "marketing", project: "p1" });
    expect(hasFilters(none)).toBe(false);
    expect(hasFilters({ ...none, min: 8 })).toBe(true);
  });

  it("採用狀態", () => {
    expect(matchFilters(idea({ adopted: true }), { ...none, adopt: "yes" })).toBe(true);
    expect(matchFilters(idea({ adopted: false }), { ...none, adopt: "yes" })).toBe(false);
    expect(matchFilters(idea({ adopted: true }), { ...none, adopt: "no" })).toBe(false);
  });

  it("專案：指定的專案、沒指定專案", () => {
    expect(matchFilters(idea({ project_id: "p1" }), { ...none, project: "p1" })).toBe(true);
    expect(matchFilters(idea({ project_id: "p2" }), { ...none, project: "p1" })).toBe(false);
    expect(matchFilters(idea({ project_id: null }), { ...none, project: "none" })).toBe(true);
    expect(matchFilters(idea({ project_id: "p1" }), { ...none, project: "none" })).toBe(false);
  });

  it("分數下限：沒分數的不算過", () => {
    expect(matchFilters(idea({ score_total: 7.2 }), { ...none, min: 7 })).toBe(true);
    expect(matchFilters(idea({ score_total: 6.9 }), { ...none, min: 7 })).toBe(false);
    expect(matchFilters(idea({ score_total: null }), { ...none, min: 6 })).toBe(false);
  });

  it("分類：沒分類的算「其他」", () => {
    expect(matchFilters(idea({ category: "marketing" }), { ...none, cat: "marketing" })).toBe(true);
    expect(matchFilters(idea({ category: null }), { ...none, cat: "other" })).toBe(true);
    expect(matchFilters(idea({ category: "mindset" }), { ...none, cat: "marketing" })).toBe(false);
  });

  it("已採用拉到上面一區，順序不變", () => {
    const list = [idea({ id: "a" }), idea({ id: "b", adopted: true }), idea({ id: "c" }), idea({ id: "d", adopted: true })];
    const { adopted, rest } = splitAdopted(list);
    expect(adopted.map((i) => i.id)).toEqual(["b", "d"]);
    expect(rest.map((i) => i.id)).toEqual(["a", "c"]);
  });
});
