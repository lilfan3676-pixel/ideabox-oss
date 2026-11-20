import "server-only";
import { callStructured } from "./ai";
import { aiLangRule } from "./aiLang";
import { db } from "./db";
import { env } from "./env";
import { ingestText } from "./ideas";
import { listProjects, logActivity, type Project } from "./projects";
import { cleanSummary, painIdeaText, painsToSave, postsForPrompt, radarTelegram, toPosts, STALE_MS, type RadarPost, type RadarReport } from "./radarLogic";
import { logRun } from "./sysLog";
import { saveRadarSwipes } from "./swipes";
import { sendToOwner } from "./telegram";

// 話題雷達：用 Apify 的 Threads 搜尋工具抓關鍵字最近一週的熱門貼文 → AI 整理主題與痛點 → 存週報、挑好的痛點存成點子。
// 每週日台北 08:00 跟著專案提醒一起跑（/api/projects/tick），專案頁也能手動「現在抓一次」。
// 沒設定 APIFY_TOKEN 或還沒執行 migration-021 就整個略過。

const ACTOR = "futurizerush~meta-threads-scraper";
const API = "https://api.apify.com/v2";
const POSTS_PER_KEYWORD = 30;
const MAX_USD_PER_RUN = 1; // 單次抓取的費用上限（Apify 會在到達時停止）
const WAIT_MS = 150_000; // 等 Apify 跑完的上限，留時間給 AI 整理與存點子

export function radarEnabled(): boolean {
  return !!env.apifyToken();
}

async function apify(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${env.apifyToken()}`, "content-type": "application/json", ...init.headers } });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json();
}

type Run = { id: string; status: string; defaultDatasetId: string };

async function startRun(keywords: string[]): Promise<Run> {
  const input = { mode: "search", keywords, max_posts: POSTS_PER_KEYWORD, search_filter: "top", search_language: "chinese", start_date: "7 days" };
  const json = (await apify(`/acts/${ACTOR}/runs?maxTotalChargeUsd=${MAX_USD_PER_RUN}`, { method: "POST", body: JSON.stringify(input) })) as { data: Run };
  return json.data;
}

const FINISHED = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/** 等所有抓取跑完（或到時間），回傳每個的資料列；沒跑完的也把已經抓到的拿回來 */
async function collect(runs: Run[], deadline: number): Promise<unknown[][]> {
  const state = runs.map((r) => ({ ...r }));
  while (Date.now() < deadline && state.some((r) => !FINISHED.has(r.status))) {
    await new Promise((ok) => setTimeout(ok, 8000));
    await Promise.all(
      state.filter((r) => !FINISHED.has(r.status)).map(async (r) => {
        const j = (await apify(`/actor-runs/${r.id}`).catch(() => null)) as { data?: Run } | null;
        if (j?.data?.status) r.status = j.data.status;
      }),
    );
  }
  return Promise.all(
    state.map(async (r) => {
      const items = await apify(`/datasets/${r.defaultDatasetId}/items?clean=true&format=json&limit=500`).catch(() => []);
      return Array.isArray(items) ? items : [];
    }),
  );
}

const SYSTEM = `你是創業家的市場研究助理。下面是 Threads 上最近一週跟某個產品相關關鍵字的熱門貼文（[編號] ♥按讚 💬留言｜內文）。
請整理：
1. overview：一兩句話，這週大家在聊什麼。
2. themes：3～6 個討論主題，每個附 detail（一兩句具體說明）與 refs（佐證的貼文編號）。
3. pains：使用者真實遇到的問題、抱怨、想要但找不到的東西（不是廣告、不是業配、不是單純分享成果）。每個附 detail、refs，以及 score（1～5）＝對這個產品的參考價值：5＝產品可以直接解決、很多人提到；1＝跟產品關係不大。
只能引用清單裡有的編號；貼文太少或都是廣告時就少寫，不要硬湊。用繁體中文、白話。`;

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    themes: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, refs: { type: "array", items: { type: "integer" } } }, required: ["title", "detail", "refs"] } },
    pains: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, refs: { type: "array", items: { type: "integer" } }, score: { type: "integer" } }, required: ["title", "detail", "refs", "score"] } },
  },
  required: ["overview", "themes", "pains"],
};

async function summarize(p: Project, posts: RadarPost[], prev: string[]) {
  const head = [`產品：${p.name}${p.description ? `｜${p.description}` : ""}`, `關鍵字：${(p.radar_keywords ?? []).join("、")}`];
  if (prev.length) head.push(`上週已經整理過的痛點（這週一樣的就不用再列進 pains，除非討論明顯變多）：${prev.join("、")}`);
  const raw = await callStructured<Parameters<typeof cleanSummary>[0]>({
    model: env.researchModel(),
    system: [SYSTEM, await aiLangRule()].filter(Boolean).join("\n\n"),
    content: `${head.join("\n")}\n\n${postsForPrompt(posts)}`,
    toolName: "radar_report",
    toolDescription: "回報這週的話題整理",
    schema: SCHEMA,
    maxTokens: 2500,
    purpose: "topic_radar",
  });
  return cleanSummary(raw, posts);
}

async function finish(id: string, patch: Partial<RadarReport>) {
  await db().from("radar_reports").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

/** 一次跑多個專案：同時開始抓、一起等，再各自整理。回傳成功的專案數 */
export async function runRadar(projects: Project[], opts: { notify: boolean; reportIds?: Record<string, string> } = { notify: true }): Promise<number> {
  const list = projects.filter((p) => p.radar_keywords?.length);
  if (!list.length || !radarEnabled()) return 0;
  // 之前被中斷、一直停在「抓取中」的，標成失敗
  await db().from("radar_reports").update({ status: "failed", error: "逾時中斷" }).eq("status", "running").lt("created_at", new Date(Date.now() - STALE_MS).toISOString());

  const deadline = Date.now() + WAIT_MS;
  const jobs = await Promise.all(
    list.map(async (p) => {
      let reportId = opts.reportIds?.[p.id];
      if (!reportId) {
        const { data, error } = await db().from("radar_reports").insert({ project_id: p.id, keywords: p.radar_keywords, status: "running" }).select("id").single();
        if (error) throw error;
        reportId = (data as { id: string }).id;
      }
      const run = await startRun(p.radar_keywords!).catch((err: unknown) => err as Error);
      return { p, reportId, run };
    }),
  );
  const started = jobs.filter((j): j is typeof j & { run: Run } => !(j.run instanceof Error));
  for (const j of jobs) if (j.run instanceof Error) await finish(j.reportId, { status: "failed", error: j.run.message.slice(0, 300) });
  const results = await collect(started.map((j) => j.run), deadline);

  const { data: prevRows } = await db().from("radar_reports").select("project_id, summary").eq("status", "done").order("created_at", { ascending: false }).limit(50);
  let ok = 0;
  await Promise.all(
    started.map(async (j, i) => {
      const t0 = Date.now();
      try {
        const posts = toPosts(results[i]);
        if (!posts.length) {
          await finish(j.reportId, { status: "done", post_count: 0, summary: { overview: "這週沒有抓到相關貼文，可以換個關鍵字試試。", themes: [], pains: [] } });
          ok++;
          return;
        }
        const last = ((prevRows ?? []) as Pick<RadarReport, "project_id" | "summary">[]).find((r) => r.project_id === j.p.id && r.summary);
        const summary = await summarize(j.p, posts, last?.summary?.pains.map((x) => x.title) ?? []);
        const save = painsToSave(summary.pains);
        const ideaIds: string[] = [];
        for (const pain of save) {
          const idea = await ingestText(painIdeaText(pain, j.p.radar_keywords!), j.p.id).catch(() => null);
          if (idea) ideaIds.push(idea.id);
        }
        await finish(j.reportId, { status: "done", post_count: posts.length, summary, idea_ids: ideaIds });
        await saveRadarSwipes(j.p.id, posts).catch(() => 0); // 這週最熱門的幾篇存進社群助手的靈感庫
        await logActivity(j.p.id, `話題雷達：看了 ${posts.length} 篇，整理出 ${summary.pains.length} 個痛點${ideaIds.length ? `，存了 ${ideaIds.length} 個點子` : ""}`, "system").catch(() => {});
        if (opts.notify) await sendToOwner(radarTelegram(j.p.name, j.p.slug, summary, posts.length, ideaIds.length, env.appUrl()));
        await logRun("radar", true, j.p.slug, Date.now() - t0);
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await finish(j.reportId, { status: "failed", error: msg.slice(0, 300) });
        await logRun("radar", false, `${j.p.slug}: ${msg}`, Date.now() - t0);
      }
    }),
  );
  return ok;
}

/** 每週日：所有進行中、有設關鍵字的專案 */
export async function runWeeklyRadar(): Promise<number> {
  if (!radarEnabled()) return 0;
  const { projects } = await listProjects();
  return runRadar(projects.filter((p) => p.status === "active"), { notify: true });
}

export async function listRadarReports(projectId: string, limit = 6): Promise<{ reports: RadarReport[]; ready: boolean }> {
  const { data, error } = await db().from("radar_reports").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) return { reports: [], ready: false };
  return { reports: (data ?? []) as RadarReport[], ready: true };
}
