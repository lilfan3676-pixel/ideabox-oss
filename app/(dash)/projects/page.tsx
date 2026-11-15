import { Suspense } from "react";
import { requireOwner } from "@/lib/auth";
import { taipeiDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { getL } from "@/lib/i18nServer";
import { listProjects, recentLogs, type Milestone } from "@/lib/projects";
import type { ProjectEvent } from "@/lib/projectLogic";
import { slackStatus } from "@/lib/slack";
import { ProjectsView } from "./ProjectsView";
import type { ActivityLog, StageLog } from "./Schedule";

export const dynamic = "force-dynamic";

// 一次載入所有專案、里程碑與最近的工作日誌，檢視切換在瀏覽器裡即時完成
export default async function ProjectsPage() {
  await requireOwner();
  const L = await getL();
  const [{ projects, ready }, slack] = await Promise.all([listProjects(), slackStatus()]);
  const has013 = !ready || !projects.length || "slack_channel" in projects[0];
  const yearAgo = new Date(Date.now() - 366 * 86_400_000).toISOString();
  const [{ data: ms }, logs, { data: stageLogs }, { data: activity }, eventsRes] = ready
    ? await Promise.all([
        db().from("project_milestones").select("*").order("due", { ascending: true }),
        recentLogs(400),
        db().from("project_logs").select("project_id, at, text").like("text", "階段：%").order("at", { ascending: true }).limit(2000),
        db().from("project_logs").select("project_id, at").gte("at", yearAgo).limit(10000),
        db().from("project_events").select("*").gte("end_date", yearAgo.slice(0, 10)).order("start_date").limit(3000),
      ])
    : [{ data: [] }, [], { data: [] }, { data: [] }, { data: [], error: true }];
  return (
    <>
      {!ready && (
        <p className="error">{L("專案功能需要先在 ideabox 的 Supabase 執行 migration-012-projects.sql。", "Projects need migration-012-projects.sql to be run on the ideabox Supabase first.")}</p>
      )}
      {ready && !has013 && (
        <p className="error">{L("Slack 進度回報需要先執行 migration-013-slack-projects.sql。", "Slack progress needs migration-013-slack-projects.sql to be run first.")}</p>
      )}
      {ready && slack && !slack.ok && (
        <p className="error">{L("Slack 連不上：", "Slack connection failed: ")}{slack.error}</p>
      )}
      {ready && !slack && (
        <p className="muted small">{L("Slack 進度回報還沒連線（沒設定 SLACK_BOT_TOKEN）。連上後各專案貼到 #progress-短名 頻道的進度會自動更新到這裡。", "Slack progress isn’t connected yet (SLACK_BOT_TOKEN not set).")}</p>
      )}
      <Suspense>
        <ProjectsView projects={projects} milestones={(ms ?? []) as Milestone[]} logs={logs} stageLogs={(stageLogs ?? []) as StageLog[]} activity={(activity ?? []) as ActivityLog[]} events={(eventsRes.data ?? []) as ProjectEvent[]} eventsReady={!eventsRes.error} today={taipeiDate()} now={Date.now()} />
      </Suspense>
    </>
  );
}
