import { getL } from "@/lib/i18nServer";
import { Suspense } from "react";
import { requirePage } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { MemberIdeas } from "./MemberIdeas";
import { db, isDesign, type Idea } from "@/lib/db";
import { listFolders } from "@/lib/folders";
import { ideaProjects } from "@/lib/projects";
import { signedUrls } from "@/lib/images";
import { parseFilters } from "@/lib/ideaFilters";
import { IdeasView } from "./IdeasView";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 點子庫（含設計收藏）：一次載入所有點子與資料夾，切換資料夾、檢視、搜尋都在瀏覽器裡即時完成
export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; folder?: string; adopt?: string; project?: string; min?: string; cat?: string }> }) {
  const { access } = await requirePage("ideas");
  if (!access.owner) {
    // 合夥人：只看他專案、分析好的點子（唯讀）
    const { projects } = await listProjects();
    const mine = projects.filter((p) => access.projects.includes(p.id));
    const { data } = mine.length
      ? await db().from("ideas").select("*").in("project_id", mine.map((p) => p.id)).eq("status", "analyzed").order("score_total", { ascending: false, nullsFirst: false }).limit(300)
      : { data: [] };
    return <MemberIdeas ideas={(data ?? []) as Idea[]} projects={mine.map((p) => ({ id: p.id, slug: p.slug, name: p.name }))} />;
  }
  const L = await getL();
  const sp = await searchParams;
  const [{ data, error }, { folders, ready }, pj] = await Promise.all([
    db().from("ideas").select("*").order("created_at", { ascending: false }).limit(800),
    listFolders(),
    ideaProjects().catch(() => ({ projects: [], ready: false })),
  ]);
  // 只傳名稱給瀏覽器；還沒執行 migration-013 時不顯示專案選單
  const projects = pj.ready ? pj.projects.map((p) => ({ id: p.id, name: p.name })) : [];
  const ideas = (data ?? []) as Idea[];
  // 只有設計卡片會顯示圖片
  const urls = await signedUrls(ideas.filter((i) => isDesign(i.category)).map((i) => i.image_path ?? ""), 3600);

  return (
    <>
      {error && <p className="error">{L("讀取失敗：", "Couldn’t load: ")}{error.message}</p>}
      <Suspense>
        <IdeasView
          ideas={ideas}
          folders={folders}
          foldersReady={ready}
          projects={projects}
          urls={urls}
          initial={{ q: (sp.q ?? "").slice(0, 50), sort: sp.sort ?? "score", folder: (sp.folder ?? "").slice(0, 40), filters: parseFilters(sp) }}
          now={Date.now()}
        />
      </Suspense>
    </>
  );
}
