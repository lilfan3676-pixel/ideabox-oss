import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { getL } from "@/lib/i18nServer";
import { listProjects } from "@/lib/projects";
import { buildProjectTabs, projectColor } from "@/lib/projectTabs";
import { ToolViews } from "../Nav";
import { ProjectTabs } from "./[slug]/ProjectTabs";

/**
 * 專案自己的工具頁最上面那一段：專案名稱＋跟專案頁同一排的分頁（現在這個工具亮著）。
 * 工具頁在最上面放 <ProjectToolBar slug="專案短名" active="分頁的 key" />；
 * views＝這一頁自己的檢視（Nav 的檢視設定用的網址，例如 "/beta"），會排在分頁下面。
 * 只有主人、而且那個專案存在時才顯示（跟左側選單把這一頁收進專案的條件一樣）；合夥人照舊從選單進來，不顯示。
 */
export async function ProjectToolBar({ slug, active, views }: { slug: string; active: string; views?: string }) {
  const { access } = await requireViewer();
  if (!access.owner) return null;
  const { projects } = await listProjects().catch(() => ({ projects: [] }));
  const index = projects.findIndex((p) => p.slug === slug);
  const project = projects[index];
  if (!project) return null;
  const [{ tabs }, L] = await Promise.all([buildProjectTabs(project, access), getL()]);
  return (
    <div className="pd-tool" style={{ ["--proj" as string]: projectColor(index) }}>
      <div className="view-line pd-head">
        <Link href="/projects" className="btn ghost small d-only">{L("← 所有專案", "← All projects")}</Link>
        <Link href={`/projects/${project.slug}`} className="pd-tool-name"><h2 className="pd-name">{project.name}</h2></Link>
      </div>
      <ProjectTabs slug={project.slug} tabs={tabs} active={active} />
      {views && <ToolViews page={views} />}
    </div>
  );
}
