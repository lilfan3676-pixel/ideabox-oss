import { getL, getLang } from "@/lib/i18nServer";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { buildBrief } from "@/lib/brief";
import { taipeiDate } from "@/lib/dates";
import { db, type Idea } from "@/lib/db";
import { timeAgo } from "@/lib/github";
import { signedUrls } from "@/lib/images";
import { clearBrief } from "../../actions";
import { ConfirmButton } from "../../ConfirmButton";
import { CopyBrief } from "./CopyBrief";
import { BarRow, SidePanel } from "../../Insight";
import { catLabel } from "@/lib/labels";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

const LINK_DAYS = 7;

export default async function BriefPage() {
  await requireOwner();
  const L = await getL();
  const { data } = await db().from("ideas").select("*").eq("in_brief", true).order("created_at", { ascending: true });
  const items = (data ?? []) as Idea[];
  const urls = await signedUrls(items.map((i) => i.image_path ?? ""), LINK_DAYS * 86_400);
  const today = taipeiDate();
  const md = buildBrief(
    items.map((i) => ({ ...i, imageUrl: i.image_path ? urls[i.image_path] : undefined })),
    today,
    timeAgo,
  );

  const lang = await getLang();
  const { projects } = await listProjects().catch(() => ({ projects: [] }));
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  // 右欄：類型與專案各有幾張
  const byType = [
    { label: L("介面設計", "UI design"), n: items.filter((i) => i.category !== "github").length },
    { label: L("GitHub 資源", "GitHub"), n: items.filter((i) => i.category === "github").length },
  ].filter((t) => t.n);
  const projCount = new Map<string, number>();
  for (const i of items) {
    const k = (i.project_id && nameOf.get(i.project_id)) || L("沒指定專案", "No project");
    projCount.set(k, (projCount.get(k) ?? 0) + 1);
  }
  const byProject = [...projCount.entries()].map(([label, n]) => ({ label, n })).sort((x, y) => y.n - x.n);
  const copy = <CopyBrief text={md} filename={`design-brief-${today}.md`} />;

  return (
    <>
      <div className="view-line d-only">
        <Link href="/?view=brief" className="btn ghost small">{L("← 回點子庫", "← Back to Ideas")}</Link>
        <h2>{L("設計簡報", "Design brief")}</h2>
        <span className="badge">{L(`已選入 ${items.length} 張`, `${items.length} selected`)}</span>
      </div>
      <div className="page-title with-action m-only">
        <div>
          <h1>{L("設計簡報", "Design brief")}</h1>
          <p className="muted">{L(`共 ${items.length} 則・複製後貼給 Claude Design，或直接貼給我`, `${items.length} items · copy and paste into Claude Design, or paste it to me`)}</p>
        </div>
        <Link href="/?view=brief" className="btn">{L("← 回點子庫", "← Back to Ideas")}</Link>
      </div>

      {!items.length ? (
        <div className="glass empty">{L("還沒有選入簡報的收藏。到設計庫在卡片上按「加入簡報」。", "Nothing in the brief yet. In Design, tap “Add to brief” on a card.")}</div>
      ) : (
        <div className="page-split brief-split">
          <div className="page-main brief-main">
            {/* 電腦版：選入的收藏排成卡片，一眼看完這份簡報裡有什麼 */}
            <ul className="brief-grid d-only" aria-label={L("選入的設計", "Selected designs")}>
              {items.map((i) => {
                const d = i.design ?? {};
                const img = i.image_path ? urls[i.image_path] : undefined;
                const proj = i.project_id ? nameOf.get(i.project_id) : undefined;
                const take = d.learn?.[0] ?? d.apply;
                return (
                  <li key={i.id} className="glass brief-card">
                    {img ? (
                      // 簽名網址會過期，不適合用 next/image 快取
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={i.summary ?? L("設計預覽", "Design preview")} loading="lazy" />
                    ) : (
                      <span className="brief-noimg" aria-hidden>{i.category === "github" ? "GitHub" : L("沒有圖", "No image")}</span>
                    )}
                    <div className="brief-card-body">
                      <div className="brief-card-meta">
                        <span className="row-cat">{catLabel(i.category, lang)}</span>
                        {proj && <span className="badge">{proj}</span>}
                        {i.score_total !== null && <b className="push">{i.score_total}</b>}
                      </div>
                      {i.url ? <a href={i.url} target="_blank" rel="noreferrer" className="brief-card-title">{i.summary ?? i.url}</a> : <span className="brief-card-title">{i.summary ?? L("未命名", "Untitled")}</span>}
                      {take && <p className="muted small">{L("想學的地方：", "Take-away: ")}{take}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            <section className="glass panel">
              <div className="panel-head d-only"><h3>{L("簡報文字（按「複製簡報」會複製這一段）", "Brief text (what “Copy brief” copies)")}</h3></div>
              <div className="m-only">{copy}</div>
              <textarea className="brief-text" readOnly value={md} rows={22} />
              <p className="muted small">{L(`預覽圖連結 ${LINK_DAYS} 天內有效，過期後重新產生一次即可。`, `Preview image links work for ${LINK_DAYS} days — regenerate the brief after that.`)}</p>
              <form action={clearBrief}>
                <ConfirmButton label={L("清空簡報清單", "Clear brief")} message={L("確定把所有收藏移出簡報？（收藏本身不會刪除）", "Remove everything from the brief? (The saved designs themselves stay.)")} />
              </form>
            </section>
          </div>
          <aside className="page-aside d-only" aria-label={L("簡報概況", "Brief overview")}>
            <SidePanel className="nudge" title={L("怎麼用", "How to use")}>
              <p>{L("按「複製簡報」，把每張的重點貼給 Claude Design 或直接貼給我，當作改版的起點。", "Copy the brief and paste it into Claude Design, or to me, as the starting point for a redesign.")}</p>
              {copy}
            </SidePanel>
            <SidePanel title={L("類型", "By type")}>
              {byType.map((t) => <BarRow key={t.label} label={t.label} n={t.n} max={items.length} />)}
            </SidePanel>
            <SidePanel title={L("用在哪個專案", "By project")}>
              {byProject.map((t) => <BarRow key={t.label} label={t.label} n={t.n} max={byProject[0].n} />)}
            </SidePanel>
          </aside>
        </div>
      )}
    </>
  );
}
