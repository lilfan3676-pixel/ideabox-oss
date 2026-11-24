import { describe, expect, it } from "vitest";
import { inProject, pageOf, splitNav } from "@/lib/navLogic";

const PAGES = [
  { href: "/" },
  { href: "/projects" },
  { href: "/grants", more: true },
  { href: "/tool", project: "fit" },
  { href: "/cafe", project: "cafe" },
  { href: "/settings" },
];

describe("左側選單的分法", () => {
  it("主人：專案自己的工具收進專案頁，標了 more 的收進「更多」", () => {
    const r = splitNav(PAGES, true, ["fit", "cafe"]);
    expect(r.main.map((p) => p.href)).toEqual(["/", "/projects", "/settings"]);
    expect(r.more.map((p) => p.href)).toEqual(["/grants"]);
    expect(r.tools.map((p) => p.href)).toEqual(["/tool", "/cafe"]);
  });

  it("專案不存在時，工具照舊留在選單（不然會進不去）", () => {
    const r = splitNav(PAGES, true, ["fit"]);
    expect(r.main.map((p) => p.href)).toContain("/cafe");
    expect(r.tools.map((p) => p.href)).toEqual(["/tool"]);
  });

  it("合夥人：選單照舊，不收進專案頁", () => {
    expect(inProject(PAGES[3], false, ["fit"])).toBe(false);
    expect(splitNav(PAGES, false, ["fit", "cafe"]).tools).toEqual([]);
  });

  it("網址對到哪一頁", () => {
    expect(pageOf(PAGES, "/tool")?.href).toBe("/tool");
    expect(pageOf(PAGES, "/tool/export")?.href).toBe("/tool");
    expect(pageOf(PAGES, "/toolbox")).toBeUndefined();
    expect(pageOf(PAGES, "/")).toBeUndefined();
  });
});
