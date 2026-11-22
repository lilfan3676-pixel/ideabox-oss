import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// 海巡畫面：用假資料渲染一次，確認共同點、類型、模板、貼文與圖片都有出來

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/(dash)/social/actions", () => ({ addSwipeAction: vi.fn(), runPatrolAction: vi.fn(), savePatrolKeywordsAction: vi.fn() }));

const { PatrolView } = await import("@/app/(dash)/social/SocialPatrol");
const { patrolStats } = await import("@/lib/patrolLogic");

const posts = Array.from({ length: 20 }, (_, i) => ({
  url: `https://www.threads.com/@u${i}/post/${i}`,
  author: `u${i}`,
  text: i < 4 ? `第一次約會選哪裡\n想問大家？` : `${"很長的一段內容".repeat(12)}\n第二行`,
  likes: 1000 - i * 40,
  replies: i < 4 ? 300 : 20,
  reposts: 3,
  views: i === 0 ? 50000 : null,
  at: "2026-11-19T14:10:00+00:00",
  images: i === 1 ? ["patrol/a.jpg"] : [],
  type: (i < 4 ? "question" : "story") as "question" | "story",
  x: Math.round((20 - i) / 4 * 10) / 10,
}));
const result = {
  summary: "短、分行、最後丟問題。",
  stats: patrolStats(posts),
  types: [{ key: "story" as const, n: 16, x: 0.8 }, { key: "question" as const, n: 4, x: 4.5 }],
  templates: [{ type: "question" as const, skeleton: "[一句情境]\n想問大家：[問題]？", why: "回答門檻低", refs: [{ url: posts[0].url, author: "u0" }] }],
  posts,
};
const project = { id: "p1", slug: "cafe", name: "Cafe", color: "#000", status: "active", canEdit: true };
const report = { id: "r1", project_id: "p1", created_at: "2026-11-22T00:00:00Z", finished_at: null, status: "done" as const, keywords: ["約會"], post_count: 20, result, error: null };

describe("PatrolView", () => {
  it("有報告：共同點、類型、模板、貼文、圖片都畫得出來", () => {
    const html = renderToStaticMarkup(
      createElement(PatrolView, {projects: [project], current: project, owner: true, aiEnabled: true, onUse: () => {}, data: { ready: true, enabled: true, keywords: ["生活"], images: { "patrol/a.jpg": "https://signed/a.jpg" }, scopes: { p1: { done: report, state: "done", error: null } } }}),
    );
    expect(html).toContain("這週高流量貼文的共同點");
    expect(html).toContain("提問互動 ×4");
    expect(html).toContain("想問大家：[問題]？");
    expect(html).toContain("用這個模板寫一篇");
    expect(html).toContain("https://signed/a.jpg");
    expect(html).toContain("50,000 次觀看");
    expect(html).toContain("約會");
  });

  it("還沒執行 migration、沒有報告時有提示", () => {
    const empty = renderToStaticMarkup(createElement(PatrolView, {projects: [project], current: null, owner: true, aiEnabled: true, onUse: () => {}, data: { ready: false, enabled: true, keywords: [], images: {}, scopes: {} }}));
    expect(empty).toContain("migration-037-patrol.sql");
    const none = renderToStaticMarkup(createElement(PatrolView, {projects: [project], current: null, owner: true, aiEnabled: true, onUse: () => {}, data: { ready: true, enabled: false, keywords: ["生活"], images: {}, scopes: {} }}));
    expect(none).toContain("還沒有不限領域的熱門報告");
    expect(none).toContain("APIFY_TOKEN");
  });
});
