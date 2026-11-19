import "server-only";
import { daysBetween, taipeiDate } from "./dates";
import { db } from "./db";
import { getOwnerContext, primaryProjectSlug } from "./owner";
import { env } from "./env";
import { buildDigest, clampStage, parseProjectCommand, type LogSource, type Milestone, type Project, type ProjectLog } from "./projectLogic";
import { esc, sendToOwner } from "./telegram";

// 專案的讀寫與每日提醒。還沒執行 migration-012 時讀取一律回傳空的、不丟錯。

export type { Milestone, Project, ProjectLog } from "./projectLogic";

const fix = (p: Project): Project => ({ ...p, stages: Array.isArray(p.stages) ? p.stages : [], stage: clampStage(p.stage, Array.isArray(p.stages) ? p.stages : []) });

export async function listProjects(): Promise<{ projects: Project[]; ready: boolean }> {
  const { data, error } = await db().from("projects").select("*").order("sort", { ascending: true });
  if (error) return { projects: [], ready: false };
  return { projects: ((data ?? []) as Project[]).map(fix), ready: true };
}

/** 點子可以對應的專案（進行中、暫停）＋描述。ready=false 代表還沒執行 migration-013（點子沒有 project_id 欄位） */
export async function ideaProjects(): Promise<{ projects: Project[]; ready: boolean }> {
  const { projects, ready } = await listProjects();
  if (!ready || !projects.length) return { projects: [], ready: false };
  const has013 = "slack_channel" in projects[0];
  const list = projects.filter((p) => p.status !== "done");
  // 主要專案（模組設定）沒填描述就沿用設定頁的「產品描述」
  const main = primaryProjectSlug();
  const first = main ? list.find((p) => p.slug === main && !p.description?.trim()) : null;
  if (first) first.description = await getOwnerContext();
  return { projects: list, ready: has013 };
}

export async function getProject(id: string): Promise<Project | null> {
  const { data } = await db().from("projects").select("*").eq("id", id).maybeSingle();
  return data ? fix(data as Project) : null;
}

/** 記一筆工作日誌，並把專案標成剛有動靜 */
export async function logActivity(projectId: string, text: string, source: LogSource) {
  const at = new Date().toISOString();
  await db().from("project_logs").insert({ project_id: projectId, text: text.slice(0, 500), source, at });
  await db().from("projects").update({ last_activity_at: at }).eq("id", projectId);
}

/** 更新專案欄位並自動記一筆日誌（例如「階段：開發 → 封測」） */
export async function updateProject(p: Project, patch: Partial<Project>, source: LogSource): Promise<void> {
  const notes: string[] = [];
  if (patch.stage !== undefined && patch.stage !== p.stage) {
    const stages = patch.stages ?? p.stages;
    notes.push(`階段：${p.stages[p.stage] ?? "—"} → ${stages[patch.stage] ?? "—"}`);
  }
  if (patch.next_step !== undefined && patch.next_step !== p.next_step && patch.next_step) notes.push(`下一步：${patch.next_step}`);
  if (patch.status !== undefined && patch.status !== p.status) notes.push(patch.status === "paused" ? "暫停專案" : patch.status === "done" ? "專案完成" : "恢復進行");
  const { error } = await db().from("projects").update({ ...patch, last_activity_at: new Date().toISOString(), stale_asked_at: null }).eq("id", p.id);
  if (error) throw error;
  for (const n of notes) await db().from("project_logs").insert({ project_id: p.id, text: n, source });
}

export async function addMilestone(projectId: string, title: string, due: string, source: LogSource, who?: string) {
  const { error } = await db().from("project_milestones").insert({ project_id: projectId, title: title.slice(0, 80), due });
  if (error) throw error;
  await logActivity(projectId, `${who ? `${who}：` : ""}新增里程碑：${title}（${due}）`, source);
}

/** 新增排程（同專案、同標題、同開始日的不重複加）；回傳新的 id，重複或失敗回傳 null */
export async function addEvent(projectId: string, title: string, start: string, end: string, source: "manual" | "telegram" | "slack", time: string | null = null, who?: string): Promise<string | null> {
  const t = title.trim().slice(0, 80);
  const { data: dup } = await db().from("project_events").select("id").eq("project_id", projectId).eq("title", t).eq("start_date", start).limit(1);
  if (dup?.length) return null;
  const row: { project_id: string; title: string; start_date: string; end_date: string; source: string; start_time?: string } = { project_id: projectId, title: t, start_date: start, end_date: end < start ? start : end, source };
  // 有時間才寫 start_time（還沒執行 migration-022 時，沒時間的排程照常能新增）
  const { data, error } = await db().from("project_events").insert(time ? { ...row, start_time: time } : row).select("id").single();
  if (error) throw error;
  await logActivity(projectId, `${who ? `${who}：` : ""}新增排程：${t}（${start === end ? start : `${start}～${end}`}${time ? ` ${time}` : ""}）`, source === "manual" ? "manual" : source);
  return (data as { id: string }).id;
}

// ---------- 每日 08:00 ----------

export async function runProjectTick(now = Date.now()): Promise<{ sent: boolean; reminded: number; stale: number }> {
  const { projects, ready } = await listProjects();
  if (!ready || !projects.length) return { sent: false, reminded: 0, stale: 0 };
  const { data } = await db().from("project_milestones").select("*").eq("done", false);
  const milestones = (data ?? []) as Milestone[];
  const today = taipeiDate(new Date(now));
  const { morningLines } = await import("./modules/registry");
  const d = buildDigest(projects, milestones, today, now, env.appUrl(), await morningLines({ now, today }));
  const msgId = await sendToOwner(d.html);
  // 有傳出去才標記，傳失敗明天會再提醒
  if (msgId) {
    if (d.remind7.length) await db().from("project_milestones").update({ reminded_7: true }).in("id", d.remind7);
    if (d.remind1.length) await db().from("project_milestones").update({ reminded_7: true, reminded_1: true }).in("id", d.remind1);
    if (d.staleAsked.length) await db().from("projects").update({ stale_asked_at: new Date(now).toISOString() }).in("id", d.staleAsked);
  }
  // 手機 App：今天的排程、里程碑提醒（推送失敗不影響 Telegram）
  const { pushTodayEvents, sendPushSafe } = await import("./app");
  await pushTodayEvents(now);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  for (const m of milestones.filter((x) => d.remind1.includes(x.id) || d.remind7.includes(x.id))) {
    const days = daysBetween(today, m.due);
    const label = days <= 0 ? "今天" : days === 1 ? "明天" : `還有 ${days} 天`;
    await sendPushSafe(
      { title: `📅 ${label}：${m.title}`, body: `${names.get(m.project_id) ?? ""} 里程碑（${m.due.slice(5).replace("-", "/")}）`.trim(), data: { screen: "today" } },
      { projectIds: [m.project_id], pages: ["projects", "calendar"] },
    );
  }
  return { sent: !!msgId, reminded: d.remind7.length + d.remind1.length, stale: d.staleAsked.length };
}

// ---------- Telegram 文字指令 ----------

/** 「<短名> 下一步 ＿＿」這類訊息：處理了就回傳回覆內容；不是專案指令回傳 null */
export async function handleProjectText(text: string): Promise<string | null> {
  if (/^(專案|\/projects?)$/i.test(text.trim())) return projectsOverview();
  const { projects, ready } = await listProjects();
  if (!ready || !projects.length) return null;
  const cmd = parseProjectCommand(text, projects, taipeiDate());
  if (!cmd) return null;
  const p = cmd.project;
  switch (cmd.action) {
    case "error":
      return `⚠️ ${esc(p.name)}：${esc(cmd.value)}`;
    case "next":
      await updateProject(p, { next_step: cmd.value }, "telegram");
      return `✅ ${esc(p.name)} 的下一步：${esc(cmd.value)}`;
    case "stage":
      await updateProject(p, { stage: cmd.value }, "telegram");
      return `✅ ${esc(p.name)} 進到「${esc(p.stages[cmd.value])}」（${cmd.value + 1}/${p.stages.length}）\n下一步要做什麼？回我「${esc(p.slug)} 下一步 ＿＿」`;
    case "log":
      await logActivity(p.id, cmd.value, "telegram");
      return `📝 已記到 ${esc(p.name)} 的工作日誌`;
    case "event": {
      const id = await addEvent(p.id, cmd.value, cmd.start, cmd.end, "telegram", cmd.time).catch(() => undefined);
      if (id === undefined) return cmd.time ? "⚠️ 排程要填時間，請先在 ideabox 的 Supabase 執行 migration-022-app.sql。" : "⚠️ 排程功能還沒啟用：請先在 ideabox 的 Supabase 執行 migration-015-events.sql。";
      const when = (cmd.start === cmd.end ? cmd.start.slice(5).replace("-", "/") : `${cmd.start.slice(5).replace("-", "/")}～${cmd.end.slice(5).replace("-", "/")}`) + (cmd.time ? ` ${cmd.time}` : "");
      return id ? `🗓 ${esc(p.name)} 新增排程：${esc(cmd.value)}（${when}），在專案頁的月曆上看得到${cmd.time ? "；開始前 30 分鐘推送到手機 App" : ""}` : `ℹ️ ${esc(p.name)} 已經有這個排程了`;
    }
    case "post":
      return (await import("./posts")).addPostFromTelegram(p, cmd.value);
    case "milestone":
      await addMilestone(p.id, cmd.value, cmd.due, "telegram");
      return `📅 ${esc(p.name)} 新增里程碑：${esc(cmd.value)}（${cmd.due}），前 7 天和前 1 天會提醒你`;
  }
}

async function projectsOverview(): Promise<string> {
  const { projects, ready } = await listProjects();
  if (!ready) return "專案功能還沒啟用：請先在 ideabox 的 Supabase 執行 migration-012-projects.sql。";
  const { data } = await db().from("project_milestones").select("*").eq("done", false);
  // 只是查詢，不標記提醒
  return buildDigest(projects, (data ?? []) as Milestone[], taipeiDate(), Date.now(), env.appUrl()).html.replace("☀️ <b>早安，今天的專案進度</b>", "📋 <b>專案進度</b>");
}

export async function recentLogs(limit = 300): Promise<ProjectLog[]> {
  const { data } = await db().from("project_logs").select("*").order("at", { ascending: false }).limit(limit);
  return (data ?? []) as ProjectLog[];
}
