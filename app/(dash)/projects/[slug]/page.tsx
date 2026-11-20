import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/auth";
import { can, editsProject, seesProject } from "@/lib/accessLogic";
import { taipeiDate } from "@/lib/dates";
import { db, type Idea } from "@/lib/db";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { listOffice } from "@/lib/office";
import { listProjects, type Milestone, type ProjectLog } from "@/lib/projects";
import { productForSlug } from "@/lib/monitorLogic";
import { monitorProducts } from "@/lib/monitor";
import { modules, projectTabs } from "@/lib/modules/registry";
import { listPosts } from "@/lib/posts";
import { listRadarReports, radarEnabled } from "@/lib/radar";
import { ProjectDetail, type ProductData } from "./ProjectDetail";
import { ProjectTabs, type TabDef } from "./ProjectTabs";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 「現在抓一次」話題雷達在背景跑

// 單一專案的詳細頁：階段歷程、里程碑、這個專案的點子、產品數據（有接監控的）、辦公室裡的人、完整日誌
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { access } = await requirePage("projects");
  const { slug } = await params;
  const { tab } = await searchParams;
  const { projects } = await listProjects();
  const index = projects.findIndex((p) => p.slug === decodeURIComponent(slug).toLowerCase());
  const project = projects[index];
  // 合夥人看不到的專案當作不存在
  if (!project || !seesProject(access, project.id)) notFound();
  // 發文排程搬到社群助手了：舊網址（Telegram 訊息裡的連結）轉過去
  if (tab === "posts") redirect(`/social?p=${project.slug}&view=posts`);
  const owner = access.owner;
  const color = Object.values(FOLDER_COLORS)[index % Object.values(FOLDER_COLORS).length];
  const now = Date.now();
  const since90 = taipeiDate(new Date(now - 90 * 86_400_000));
  const products = await monitorProducts().catch(() => []);
  const pkey = productForSlug(project.slug, products);
  const info = products.find((p) => p.key === pkey) ?? null;
  // 模組提供的回報時間（例如封測回報），第一個有回應的為準
  const feedbackOf = async () => {
    const since = new Date(now - 84 * 86_400_000).toISOString();
    if (!owner) return null; // 模組的回報（例如封測）只有你看得到
    for (const m of modules()) {
      const r = m.projectFeedback ? await m.projectFeedback(project.slug, since).catch(() => null) : null;
      if (r) return r;
    }
    return null;
  };

  const [{ data: ms }, { data: logs }, ideasRes, { data: daily }, { data: services }, office, feedback, radar, postList] = await Promise.all([
    db().from("project_milestones").select("*").eq("project_id", project.id).order("due", { ascending: true }),
    db().from("project_logs").select("*").eq("project_id", project.id).order("at", { ascending: false }).limit(500),
    // 還沒執行 migration-013 時沒有 project_id 欄位，當作沒有點子
    db().from("ideas").select("*").eq("project_id", can(access, "ideas") ? project.id : "00000000-0000-0000-0000-000000000000").order("score_total", { ascending: false, nullsFirst: false }).limit(200),
    db().from("monitor_daily").select("*").eq("product", pkey ?? project.slug).gte("day", since90).order("day"),
    db().from("monitor_status").select("service, ok, checked_at, latency_ms").eq("product", pkey ?? project.slug),
    owner ? listOffice(now) : { sessions: [], ready: false },
    feedbackOf(),
    can(access, "radar") ? listRadarReports(project.id) : { reports: [], ready: false },
    listPosts(project.id),
  ]);

  // 分頁：總覽（原本的內容）、發文排程（在社群助手，這裡是捷徑）
  const tabDefs: TabDef[] = [
    { key: "", label: ["總覽", "Overview"] },
    { key: "posts", href: `/social?p=${project.slug}`, label: ["發文排程", "Posts"], count: postList.posts.filter((x) => x.status === "draft" || x.status === "scheduled").length },
  ];
  // 模組加的分頁（例如某個專案專用的名單）
  const canEdit = editsProject(access, project.id);
  const extra = await projectTabs({ project, access, canEdit, today: taipeiDate() });
  const moved = extra.find((t) => t.key === tab && t.href);
  if (moved) redirect(moved.href!);
  for (const t of extra) tabDefs.push({ key: t.key, label: t.label, count: t.count, href: t.href });
  const active = tabDefs.some((t) => t.key === tab) ? tab! : "";
  const panel: React.ReactNode = await extra.find((t) => t.key === active)?.render?.();

  const product: ProductData = {
    info,
    daily: (daily ?? []) as ProductData["daily"],
    services: (services ?? []) as ProductData["services"],
    feedback,
  };

  return (
    <ProjectDetail
      project={project}
      color={color}
      milestones={(ms ?? []) as Milestone[]}
      logs={(logs ?? []) as ProjectLog[]}
      ideas={ideasRes.error ? [] : ((ideasRes.data ?? []) as Idea[])}
      showIdeas={can(access, "ideas")}
      showRadar={can(access, "radar")}
      showProduct={can(access, "monitor")}
      product={product}
      people={office.sessions.filter((s) => s.project_id === project.id)}
      radar={{ reports: radar.reports, ready: radar.ready && "radar_keywords" in project, enabled: radarEnabled() }}
      today={taipeiDate()}
      now={now}
      tabs={<ProjectTabs slug={project.slug} tabs={tabDefs} active={active} />}
      panel={panel}
    />
  );
}
