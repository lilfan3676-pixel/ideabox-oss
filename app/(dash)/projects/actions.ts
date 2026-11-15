"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { parseTime } from "@/lib/appTime";
import { isIsoDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { getL } from "@/lib/i18nServer";
import { cleanLinks, cleanSlug, cleanStages, clampStage, LINK_LABEL, type ProjectStatus } from "@/lib/projectLogic";
import { addMilestone, getProject, listProjects, logActivity, updateProject } from "@/lib/projects";

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const STATUSES: ProjectStatus[] = ["active", "paused", "done"];
export type ProjectResult = { ok: boolean; error?: string };
const done = (): ProjectResult => {
  revalidatePath("/projects");
  return { ok: true };
};

export async function createProject(name: string, stagesText: string): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!clean) return { ok: false, error: L("請輸入專案名稱", "Enter a project name") };
  const { projects, ready } = await listProjects();
  if (!ready) return { ok: false, error: L("請先執行 migration-012-projects.sql", "Run migration-012-projects.sql first") };
  let slug = cleanSlug(clean) || `p${projects.length + 1}`;
  while (projects.some((p) => p.slug === slug)) slug = `${slug}-2`.slice(0, 20);
  const stages = cleanStages(stagesText);
  const { error } = await db().from("projects").insert({
    name: clean,
    slug,
    stages: stages.length ? stages : ["構想", "開發", "上線", "維運"],
    sort: Math.max(0, ...projects.map((p) => p.sort)) + 10,
  });
  if (error) return { ok: false, error: error.message };
  return done();
}

export async function saveProjectSettings(
  id: string,
  v: { name: string; slug: string; stages: string; folder: string; repo: string; status: string; description?: string; slack?: string; links?: Record<string, string> },
): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const p = isUuid(id) ? await getProject(id) : null;
  if (!p) return { ok: false };
  const name = String(v.name ?? "").trim().slice(0, 40);
  const slug = cleanSlug(v.slug);
  const stages = cleanStages(v.stages);
  if (!name || !slug) return { ok: false, error: L("名稱和短名都要填", "Name and short name are required") };
  if (!stages.length) return { ok: false, error: L("至少要有一個階段", "Add at least one stage") };
  const { projects } = await listProjects();
  if (projects.some((x) => x.slug === slug && x.id !== id)) return { ok: false, error: L("這個短名已經有專案在用", "That short name is taken") };
  const status = STATUSES.includes(v.status as ProjectStatus) ? (v.status as ProjectStatus) : p.status;
  const repo = String(v.repo ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$|\/+$/g, "").slice(0, 100);
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: L("GitHub repo 格式是 owner/name", "GitHub repo should look like owner/name") };
  // 階段改了以後，盡量停在同名的階段；找不到就停在原本位置（超出就到最後一個）
  const cur = p.stages[p.stage];
  const keep = stages.indexOf(cur);
  const stage = keep >= 0 ? keep : clampStage(p.stage, stages);
  const patch: Parameters<typeof updateProject>[1] = { name, slug, stages, stage, status, folder: String(v.folder ?? "").trim().slice(0, 80) || null, repo: repo || null };
  // 描述與 Slack 頻道是 migration-013 才有的欄位：有改才寫，避免還沒執行時整個存不了
  const description = String(v.description ?? "").trim().slice(0, 2000) || null;
  const slack = String(v.slack ?? "").trim().replace(/^#/, "").toLowerCase().slice(0, 80) || null;
  if (description !== (p.description ?? null)) patch.description = description;
  if (slack !== (p.slack_channel ?? null)) patch.slack_channel = slack;
  if (v.links) {
    const { links, bad } = cleanLinks(v.links);
    if (bad.length) return { ok: false, error: L(`這些連結看起來不是網址：${bad.map((k) => LINK_LABEL[k][0]).join("、")}`, `These don’t look like URLs: ${bad.map((k) => LINK_LABEL[k][1]).join(", ")}`) };
    if (JSON.stringify(links) !== JSON.stringify(p.links ?? {})) patch.links = links;
  }
  try {
    await updateProject(p, patch, "manual");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    if (/description|slack_channel/.test(msg)) return { ok: false, error: L("請先執行 migration-013-slack-projects.sql", "Run migration-013-slack-projects.sql first") };
    if (/links/.test(msg)) return { ok: false, error: L("連結需要先執行 migration-016-project-links.sql", "Run migration-016-project-links.sql first") };
    return { ok: false, error: msg.slice(0, 120) };
  }
  return done();
}

export async function setStage(id: string, stage: number): Promise<ProjectResult> {
  await requireOwner();
  const p = isUuid(id) ? await getProject(id) : null;
  if (!p || !Number.isInteger(stage) || stage < 0 || stage >= p.stages.length) return { ok: false };
  await updateProject(p, { stage }, "manual");
  return done();
}

export async function setNextStep(id: string, text: string): Promise<ProjectResult> {
  await requireOwner();
  const p = isUuid(id) ? await getProject(id) : null;
  if (!p) return { ok: false };
  await updateProject(p, { next_step: String(text ?? "").trim().slice(0, 200) || null }, "manual");
  return done();
}

export async function addLog(id: string, text: string): Promise<ProjectResult> {
  await requireOwner();
  const t = String(text ?? "").trim();
  if (!isUuid(id) || !t) return { ok: false };
  await logActivity(id, t, "manual");
  return done();
}

export async function addMilestoneAction(id: string, title: string, due: string): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const t = String(title ?? "").trim();
  if (!isUuid(id)) return { ok: false };
  if (!t || !isIsoDate(due)) return { ok: false, error: L("請填日期和名稱", "Enter a date and a title") };
  await addMilestone(id, t, due, "manual");
  return done();
}

export async function toggleMilestone(id: string): Promise<ProjectResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false };
  const { data } = await db().from("project_milestones").select("*").eq("id", id).maybeSingle();
  const m = data as { id: string; project_id: string; title: string; done: boolean } | null;
  if (!m) return { ok: false };
  await db().from("project_milestones").update({ done: !m.done }).eq("id", id);
  if (!m.done) await logActivity(m.project_id, `完成里程碑：${m.title}`, "manual");
  return done();
}

export async function deleteMilestone(id: string): Promise<ProjectResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false };
  await db().from("project_milestones").delete().eq("id", id);
  return done();
}

export async function deleteProject(id: string): Promise<ProjectResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false };
  await db().from("projects").delete().eq("id", id);
  return done();
}

/** 立即讀一次 Slack（不用等 5 分鐘），回傳讀到什麼、哪些頻道找不到，方便檢查設定 */
export async function syncSlackNow(): Promise<{ ok: boolean; text: string }> {
  await requireOwner();
  const L = await getL();
  const { runSlackSync } = await import("@/lib/slack");
  try {
    const r = await runSlackSync();
    revalidatePath("/projects");
    if (r.skipped) return { ok: false, text: L("還沒設定 SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN isn’t set") };
    const parts = [
      r.messages
        ? L(`讀到 ${r.messages} 則新回報，更新了 ${r.projects} 個專案`, `Read ${r.messages} new update(s) for ${r.projects} project(s)`)
        : L("沒有新的回報", "No new updates"),
    ];
    if (r.missing?.length)
      parts.push(L(`找不到這些頻道（還沒建、名稱不同，或私人頻道還沒邀請 ideabox）：#${r.missing.join("、#")}`, `Channels not found (not created, different name, or private without ideabox invited): #${r.missing.join(", #")}`));
    if (r.errors?.length) parts.push(r.errors.join("；"));
    return { ok: !r.errors?.length, text: parts.join("。") };
  } catch (err) {
    return { ok: false, text: L("讀取失敗：", "Failed: ") + (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

// ---------- 排程（月曆） ----------

const okDate = (s: unknown): s is string => typeof s === "string" && isIsoDate(s);

export async function addEventAction(projectId: string, title: string, start: string, end: string, time?: string): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const t = String(title ?? "").trim();
  if (!isUuid(projectId) || !t || !okDate(start)) return { ok: false, error: L("請填標題和日期", "Enter a title and date") };
  const e = okDate(end) && end >= start ? end : start;
  try {
    const { addEvent } = await import("@/lib/projects");
    const id = await addEvent(projectId, t, start, e, "manual", parseTime(time));
    if (!id) return { ok: false, error: L("這個排程已經有了", "This item already exists") };
  } catch {
    return parseTime(time)
      ? { ok: false, error: L("要填時間請先執行 migration-022-app.sql（或先清掉時間）", "Run migration-022-app.sql to use times (or clear the time)") }
      : { ok: false, error: L("請先執行 migration-015-events.sql", "Run migration-015-events.sql first") };
  }
  return done();
}

export async function updateEventAction(id: string, v: { title: string; start: string; end: string; time?: string; projectId: string }): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const t = String(v.title ?? "").trim().slice(0, 80);
  if (!isUuid(id) || !isUuid(v.projectId) || !t || !okDate(v.start)) return { ok: false, error: L("請填標題和日期", "Enter a title and date") };
  const end = okDate(v.end) && v.end >= v.start ? v.end : v.start;
  const time = parseTime(v.time);
  // 改了日期或時間就重新提醒；還沒執行 migration-022 的話只存日期
  const withTime = { title: t, start_date: v.start, end_date: end, project_id: v.projectId, start_time: time, reminded: false };
  let { error } = await db().from("project_events").update(withTime).eq("id", id);
  if (error && /start_time|reminded/.test(error.message)) {
    if (time) return { ok: false, error: L("要填時間請先執行 migration-022-app.sql", "Run migration-022-app.sql to use times") };
    ({ error } = await db().from("project_events").update({ title: t, start_date: v.start, end_date: end, project_id: v.projectId }).eq("id", id));
  }
  if (error) return { ok: false, error: error.message.slice(0, 120) };
  return done();
}

export async function deleteEventAction(id: string): Promise<ProjectResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false };
  await db().from("project_events").delete().eq("id", id);
  return done();
}

// ---------- 話題雷達 ----------

export async function saveRadarKeywords(id: string, text: string): Promise<ProjectResult & { keywords?: string[] }> {
  await requireOwner();
  const L = await getL();
  if (!isUuid(id)) return { ok: false };
  const { cleanKeywords } = await import("@/lib/radarLogic");
  const keywords = cleanKeywords(String(text ?? ""));
  const { error } = await db().from("projects").update({ radar_keywords: keywords }).eq("id", id);
  if (error) return { ok: false, error: /radar_keywords/.test(error.message) ? L("請先執行 migration-021-radar.sql", "Run migration-021-radar.sql first") : error.message.slice(0, 120) };
  revalidatePath("/projects");
  return { ok: true, keywords };
}

/** 現在抓一次：先建一筆「抓取中」，背景跑完再更新（大約 1～3 分鐘），不傳 Telegram */
export async function runRadarNow(id: string): Promise<ProjectResult> {
  await requireOwner();
  const L = await getL();
  const p = isUuid(id) ? await getProject(id) : null;
  if (!p) return { ok: false };
  const { radarEnabled, runRadar } = await import("@/lib/radar");
  const { STALE_MS } = await import("@/lib/radarLogic");
  if (!radarEnabled()) return { ok: false, error: L("還沒設定 APIFY_TOKEN", "APIFY_TOKEN isn’t set") };
  if (!p.radar_keywords?.length) return { ok: false, error: L("請先設定關鍵字", "Add keywords first") };
  const { data: running } = await db().from("radar_reports").select("id").eq("project_id", id).eq("status", "running").gte("created_at", new Date(Date.now() - STALE_MS).toISOString()).limit(1);
  if (running?.length) return { ok: false, error: L("正在抓了，等一下再看", "Already running") };
  const { data, error } = await db().from("radar_reports").insert({ project_id: id, keywords: p.radar_keywords, status: "running" }).select("id").single();
  if (error) return { ok: false, error: L("請先執行 migration-021-radar.sql", "Run migration-021-radar.sql first") };
  const { after } = await import("next/server");
  after(() => runRadar([p], { notify: false, reportIds: { [id]: (data as { id: string }).id } }).catch(() => 0));
  revalidatePath("/projects");
  return { ok: true };
}
