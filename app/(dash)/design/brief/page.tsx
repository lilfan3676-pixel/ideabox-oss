import { getL } from "@/lib/i18nServer";
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

  return (
    <>
      <div className="page-title with-action">
        <div>
          <h1>{L("設計簡報", "Design brief")}</h1>
          <p className="muted">{L(`共 ${items.length} 則・複製後貼給 Claude Design，或直接貼給我`, `${items.length} items · copy and paste into Claude Design, or paste it to me`)}</p>
        </div>
        <Link href="/?view=brief" className="btn">{L("← 回點子庫", "← Back to Ideas")}</Link>
      </div>

      {!items.length ? (
        <div className="glass empty">{L("還沒有選入簡報的收藏。到設計庫在卡片上按「加入簡報」。", "Nothing in the brief yet. In Design, tap “Add to brief” on a card.")}</div>
      ) : (
        <section className="glass panel">
          <CopyBrief text={md} filename={`design-brief-${today}.md`} />
          <textarea className="brief-text" readOnly value={md} rows={22} />
          <p className="muted small">{L(`預覽圖連結 ${LINK_DAYS} 天內有效，過期後重新產生一次即可。`, `Preview image links work for ${LINK_DAYS} days — regenerate the brief after that.`)}</p>
          <form action={clearBrief}>
            <ConfirmButton label={L("清空簡報清單", "Clear brief")} message={L("確定把所有收藏移出簡報？（收藏本身不會刪除）", "Remove everything from the brief? (The saved designs themselves stay.)")} />
          </form>
        </section>
      )}
    </>
  );
}
