import { Suspense } from "react";
import { requirePage } from "@/lib/auth";
import { editsProject, seesProject } from "@/lib/accessLogic";
import { taipeiDate } from "@/lib/dates";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { signedUrls } from "@/lib/images";
import { getL } from "@/lib/i18nServer";
import { FORMAT_MIGRATION, POSTS_MIGRATION, draftEnabled, listPosts } from "@/lib/posts";
import { listProjects } from "@/lib/projects";
import { listSwipes } from "@/lib/swipes";
import { db } from "@/lib/db";
import type { ProfileResult } from "@/lib/engageLogic";
import { SocialView, type SocialProject } from "./SocialView";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // AI 寫腳本

// 社群助手：所有專案的社群貼文。首頁是一週看板（可以請 AI 排這週），另外有完整的排程清單與爆款靈感庫。
// 看＝看得到專案頁的人（只列他看得到的專案）；新增、修改要主人或這個專案「可編輯」的合夥人。
export default async function SocialPage() {
  const { access } = await requirePage("projects");
  const L = await getL();
  const [{ projects: all, ready: projectsReady }, postList] = await Promise.all([listProjects(), listPosts()]);
  const palette = Object.values(FOLDER_COLORS);
  const projects: SocialProject[] = all
    .map((p, i) => ({ id: p.id, slug: p.slug, name: p.name, color: palette[i % palette.length], status: p.status, canEdit: editsProject(access, p.id) }))
    .filter((p) => seesProject(access, p.id));
  const ids = new Set(projects.map((p) => p.id));
  const posts = postList.posts.filter((p) => ids.has(p.project_id));
  const swipeList = await listSwipes([...ids]);
  // migration-031：貼文的內容類型、靈感庫
  const hasKind = swipeList.ready;
  // 個人檔案健檢：每個專案上一次的結果（存在 settings）
  const { data: profileRows } = await db().from("settings").select("key, value").like("key", "social_profile:%");
  const profiles: Record<string, ProfileResult> = {};
  for (const r of (profileRows ?? []) as { key: string; value: string }[]) {
    const id = r.key.slice("social_profile:".length);
    if (!ids.has(id)) continue;
    try {
      const v = JSON.parse(r.value) as ProfileResult;
      if (Array.isArray(v?.items)) profiles[id] = v;
    } catch {
      // 壞掉的紀錄當作沒有
    }
  }
  // migration-032：已發貼文的成效數字
  const hasMetrics = !posts.length || "metrics" in posts[0];
  const images = await signedUrls(posts.map((p) => p.image_path ?? "").filter(Boolean), 3600);
  // 還沒執行 migration-030 時貼文沒有 format 欄位（沒有貼文時先當作有，存檔失敗會提示）
  const hasFormat = !posts.length || "format" in posts[0];

  if (!projectsReady || !postList.ready) {
    return <p className="notice glass">{L(`社群助手需要先在 ideabox 的 Supabase 執行 ${projectsReady ? POSTS_MIGRATION : "migration-012-projects.sql"}。`, `Run ${projectsReady ? POSTS_MIGRATION : "migration-012-projects.sql"} on the ideabox Supabase to use the social assistant.`)}</p>;
  }
  return (
    <>
      {!hasFormat && access.owner && (
        <p className="notice glass">{L(`Reel／輪播／限動腳本需要先執行 ${FORMAT_MIGRATION}；一般貼文的排程照常能用。`, `Run ${FORMAT_MIGRATION} to use Reel, carousel and story scripts. Regular posts work as before.`)}</p>
      )}
      <Suspense>
        <SocialView projects={projects} posts={posts} images={images} aiEnabled={draftEnabled()} hasFormat={hasFormat} hasKind={hasKind} hasMetrics={hasMetrics} swipes={swipeList.swipes} swipesReady={swipeList.ready} profiles={profiles} today={taipeiDate()} now={Date.now()} />
      </Suspense>
    </>
  );
}
