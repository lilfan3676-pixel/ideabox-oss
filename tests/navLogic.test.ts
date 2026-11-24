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

import { groupMemberPages, type MemberPage } from "@/lib/accessLogic";

describe("合夥人設定：畫面勾選的分組", () => {
  const page = (key: string, project?: string) => ({ key, zh: key, en: key, project }) as unknown as MemberPage;
  it("沒有專案的是共用的畫面；有專案的照專案一組，順序照清單", () => {
    const g = groupMemberPages([page("projects"), page("cafe", "fit"), page("grants"), page("list", "shop"), page("growth", "fit")]);
    expect(g.shared.map((p) => p.key)).toEqual(["projects", "grants"]);
    expect(g.tools.map((t) => [t.project, t.pages.map((p) => p.key)])).toEqual([["fit", ["cafe", "growth"]], ["shop", ["list"]]]);
  });
  it("清單裡沒有專案的工具時，tools 是空的（公開版）", () => {
    expect(groupMemberPages([page("projects")]).tools).toEqual([]);
  });
});
