import { Suspense } from "react";
import { requireOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { getL } from "@/lib/i18nServer";
import { listOffice } from "@/lib/office";
import { listProjects } from "@/lib/projects";
import { OfficeView } from "./OfficeView";

export const dynamic = "force-dynamic";

// 辦公室：每 10 秒重新整理一次（OfficeView 裡的 router.refresh）
// 只有填了「資料夾名稱」的專案才有房間（沒有資料夾就不會有 Claude Code 在裡面工作）
export default async function OfficePage() {
  await requireOwner();
  const L = await getL();
  const now = Date.now();
  const [{ projects }, { sessions, ready }] = await Promise.all([listProjects(), listOffice(now)]);
  return (
    <>
      {!ready && <p className="error">{L("辦公室需要先在 ideabox 的 Supabase 執行 migration-014-office.sql。", "The office needs migration-014-office.sql to be run first.")}</p>}
      {ready && !env.claudeHookSecret() && (
        <p className="muted small">{L("還沒連上電腦的 Claude Code（Vercel 沒有設定 CLAUDE_HOOK_SECRET），辦公室會一直是空的。", "Claude Code on your Mac isn’t connected yet (CLAUDE_HOOK_SECRET not set).")}</p>
      )}
      <Suspense>
        <OfficeView projects={projects.filter((p) => p.folder?.trim()).map((p) => ({ id: p.id, name: p.name, stages: p.stages, stage: p.stage, status: p.status }))} sessions={sessions} now={now} />
      </Suspense>
    </>
  );
}
