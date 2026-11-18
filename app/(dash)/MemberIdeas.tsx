import Link from "next/link";
import { getL } from "@/lib/i18nServer";
import { CATEGORY_LABEL, type Idea } from "@/lib/db";

// 合夥人的點子庫：只列他專案的點子（唯讀），依專案分組
export async function MemberIdeas({ ideas, projects }: { ideas: Idea[]; projects: { id: string; slug: string; name: string }[] }) {
  const L = await getL();
  return (
    <>
      <div className="page-title">
        <h1>{L("點子庫", "Ideas")}</h1>
        <p className="muted">{L(`你的專案的點子・${ideas.length} 則`, `Ideas for your projects・${ideas.length}`)}</p>
      </div>
      {projects.map((p) => {
        const list = ideas.filter((i) => i.project_id === p.id);
        if (!list.length) return null;
        return (
          <section key={p.id} className="glass pd-card">
            <h2 className="detail-h"><Link href={`/projects/${p.slug}`}>{p.name}</Link>（{list.length}）</h2>
            <ul className="pd-ideas">
              {list.map((i) => (
                <li key={i.id}>
                  <span className="row-score">{i.score_total ?? "—"}</span>
                  <span className="pd-idea-text">
                    {i.adopted && "✓ "}
                    {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.summary || i.content?.slice(0, 60)}</a> : i.summary || i.content?.slice(0, 60)}
                    {i.next_step && <span className="muted small">　👉 {i.next_step}</span>}
                  </span>
                  {i.category && <span className="badge">{CATEGORY_LABEL[i.category] ?? i.category}</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!ideas.length && <p className="muted">{L("你的專案還沒有點子。", "No ideas for your projects yet.")}</p>}
    </>
  );
}
