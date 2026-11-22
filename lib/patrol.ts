import "server-only";
import { callStructured } from "./ai";
import { db } from "./db";
import { env } from "./env";
import { downloadImage, removeImage, signedUrls, storeImage } from "./images";
import { AI_POSTS, DEFAULT_GENERAL, KEEP_POSTS, PATROL_STALE_MS, POST_TYPES, TYPE_KEYS, applyPatrol, latestByScope, patrolStats, postsForPrompt, toPatrolPosts, typeCounts, type PatrolPost, type PatrolReport, type PatrolResult } from "./patrolLogic";
import { collect, radarEnabled, startRun } from "./radar";
import { cleanKeywords } from "./radarLogic";
import { logRun } from "./sysLog";

// Threads 海巡：看高流量貼文長什麼樣子 → 共同點（程式算）＋每種類型一個模板（AI 寫骨架）。
// 專案的：每週日話題雷達抓完，用同一批貼文順便分析（radar.ts 會呼叫 analyzePatrol），也能手動「現在抓一次」。
// 不限領域的熱門：用 settings.patrol_keywords 的詞另外抓一次。
// 沒設定 APIFY_TOKEN 或還沒執行 migration-037 就整個略過。

export const PATROL_MIGRATION = "migration-037-patrol.sql";
const GENERAL_POSTS_PER_KEYWORD = 40;
const WAIT_MS = 150_000;
const KEEP_REPORTS = 4; // 每個範圍留最近幾份（更舊的連圖片一起刪）
const KEYWORDS_KEY = "patrol_keywords";

export type PatrolScope = { projectId: string | null; name: string; description: string; keywords: string[] };

export const patrolEnabled = radarEnabled;

const SYSTEM = `你是社群內容研究員。下面是 Threads 上最近一週互動最高的貼文（[編號] ♥按讚 💬留言 🔁轉發 🖼有圖｜內文，「⏎」是換行）。
請做三件事：
1. types：把每一篇歸到一種類型（只能用這些代號）：
${POST_TYPES.map((t) => `   ${t.key}＝${t.label[0]}：${t.hint}`).join("\n")}
   看「這篇怎麼寫」來分，不是看它在講什麼主題。廣告、抽獎、純轉貼新聞這種學不了的可以不分。
2. templates：有 2 篇以上的類型，各寫一個模板：
   - skeleton：填空式的骨架。用方括號 [ ] 寫每個位置要放什麼（例如 [一句大家都有經驗的情境]），保留這類貼文實際的分行、長度與結尾做法；可以保留少數固定的口語連接詞（例如「想問大家：」）。不可以出現原貼文的內容、帳號、品牌或數字。3～8 行。
   - why：一句話，這種寫法為什麼容易有互動（根據這批貼文看得到的事，不要講平台內部怎麼運作）。
   - refs：最能代表這個模板的貼文編號，最多 3 個。
3. summary：一兩句白話結論，這週高互動的貼文在寫法上有什麼共同點。
只能引用清單裡有的編號。用繁體中文、白話，不要用破折號。`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    types: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, type: { type: "string", enum: TYPE_KEYS } }, required: ["n", "type"] } },
    templates: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: TYPE_KEYS }, skeleton: { type: "string" }, why: { type: "string" }, refs: { type: "array", items: { type: "integer" } } }, required: ["type", "skeleton", "why", "refs"] } },
  },
  required: ["summary", "types", "templates"],
};

function aiEnabled(): boolean {
  try {
    return Boolean(env.anthropicKey());
  } catch {
    return false;
  }
}

/** 把貼文的圖片下載存進 Storage（平台的圖片網址幾天就失效）；抓不到的就略過 */
async function keepImages(posts: PatrolPost[], deadline: number): Promise<void> {
  const jobs = posts.flatMap((p) => p.images.map((url) => ({ p, url })));
  const saved = new Map<string, string>();
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() < deadline) {
      const { url } = jobs[next++];
      const img = await downloadImage(url).catch(() => null);
      const path = img ? await storeImage(img) : null;
      if (path) saved.set(url, path);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const p of posts) p.images = p.images.map((u) => saved.get(u)).filter((x): x is string => !!x);
}

async function finish(id: string, patch: Partial<PatrolReport>) {
  await db().from("patrol_reports").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

/** 只留最近幾份，舊的連圖片一起刪 */
async function prune(projectId: string | null) {
  let q = db().from("patrol_reports").select("id, result").order("created_at", { ascending: false }).limit(40);
  q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
  const { data } = await q;
  const old = ((data ?? []) as Pick<PatrolReport, "id" | "result">[]).slice(KEEP_REPORTS);
  for (const r of old) {
    for (const path of r.result?.posts.flatMap((p) => p.images) ?? []) await removeImage(path);
    await db().from("patrol_reports").delete().eq("id", r.id);
  }
}

/**
 * 分析一批抓回來的資料列並存成報告。reportId 有給就更新那一筆（手動按的），沒給就新增。
 * AI 沒設定或失敗時照樣存共同點與貼文，只是沒有類型與模板。
 */
export async function analyzePatrol(scope: PatrolScope, items: unknown[], reportId?: string): Promise<boolean> {
  const t0 = Date.now();
  const label = scope.projectId ? scope.name : "general";
  if (!reportId) {
    const { data, error } = await db().from("patrol_reports").insert({ project_id: scope.projectId, keywords: scope.keywords, status: "running" }).select("id").single();
    if (error) return false; // 還沒執行 migration-037
    reportId = (data as { id: string }).id;
  }
  try {
    const posts = toPatrolPosts(items);
    let summary = "";
    let templates: PatrolResult["templates"] = [];
    if (posts.length >= 5 && aiEnabled()) {
      try {
        const raw = await callStructured<Parameters<typeof applyPatrol>[0]>({
          model: env.researchModel(),
          system: SYSTEM,
          content: `${scope.projectId ? `這批貼文是用這些關鍵字找的：${scope.keywords.join("、")}` : "這批貼文不限領域。"}\n\n${postsForPrompt(posts)}`,
          toolName: "patrol_report",
          toolDescription: "回報貼文類型與各類型的模板",
          schema: SCHEMA,
          maxTokens: 4000,
          purpose: "threads_patrol",
        });
        ({ summary, templates } = applyPatrol(raw, posts.slice(0, AI_POSTS)));
      } catch (err) {
        console.error("patrol ai", err);
      }
    }
    const keep = posts.slice(0, KEEP_POSTS);
    await keepImages(keep, Date.now() + 45_000);
    const result: PatrolResult = { summary, stats: patrolStats(posts), types: typeCounts(posts), templates, posts: keep };
    await finish(reportId, { status: "done", post_count: posts.length, result });
    await prune(scope.projectId).catch(() => {});
    await logRun("patrol", true, `${label}: ${posts.length}`, Date.now() - t0);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finish(reportId, { status: "failed", error: msg.slice(0, 300) });
    await logRun("patrol", false, `${label}: ${msg}`, Date.now() - t0);
    return false;
  }
}

/** 自己抓一次再分析（手動按的，或不限領域的每週排程） */
export async function runPatrol(scope: PatrolScope, reportId?: string): Promise<boolean> {
  if (!patrolEnabled() || !scope.keywords.length) return false;
  try {
    const run = await startRun(scope.keywords, scope.projectId ? undefined : GENERAL_POSTS_PER_KEYWORD);
    const [items] = await collect([run], Date.now() + WAIT_MS);
    return await analyzePatrol(scope, items, reportId);
  } catch (err) {
    if (reportId) await finish(reportId, { status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
    return false;
  }
}

export async function generalKeywords(): Promise<string[]> {
  const { data } = await db().from("settings").select("value").eq("key", KEYWORDS_KEY).maybeSingle();
  try {
    const list = JSON.parse((data as { value: string } | null)?.value ?? "null");
    if (Array.isArray(list)) return cleanKeywords(list.map(String));
  } catch {
    // 壞掉的設定當作沒有
  }
  return DEFAULT_GENERAL;
}

export async function saveGeneralKeywords(input: string): Promise<string[]> {
  const list = cleanKeywords(input);
  await db().from("settings").upsert({ key: KEYWORDS_KEY, value: JSON.stringify(list) }, { onConflict: "key" });
  return list;
}

export const generalScope = async (): Promise<PatrolScope> => ({ projectId: null, name: "general", description: "", keywords: await generalKeywords() });

/** 每週日：不限領域的熱門（專案的由話題雷達順便做） */
export async function runWeeklyPatrol(): Promise<boolean> {
  if (!patrolEnabled()) return false;
  return runPatrol(await generalScope());
}

/** 有沒有正在抓的（避免重複按） */
export async function patrolRunning(projectId: string | null): Promise<boolean> {
  let q = db().from("patrol_reports").select("id").eq("status", "running").gte("created_at", new Date(Date.now() - PATROL_STALE_MS).toISOString()).limit(1);
  q = projectId ? q.eq("project_id", projectId) : q.is("project_id", null);
  const { data } = await q;
  return !!data?.length;
}

/** 開一筆「抓取中」；回傳 null＝還沒執行 migration-037 */
export async function openPatrol(scope: PatrolScope): Promise<string | null> {
  const { data, error } = await db().from("patrol_reports").insert({ project_id: scope.projectId, keywords: scope.keywords, status: "running" }).select("id").single();
  return error ? null : (data as { id: string }).id;
}

/** 畫面用：每個範圍最新的報告與狀態，加上圖片的簽名網址。ready=false 代表還沒執行 migration-037 */
export async function loadPatrol(projectIds: string[]) {
  const { data, error } = await db().from("patrol_reports").select("*").order("created_at", { ascending: false }).limit(60);
  if (error) return { ready: false, scopes: {} as ReturnType<typeof latestByScope>, images: {} as Record<string, string> };
  const ids = new Set(projectIds);
  const rows = ((data ?? []) as PatrolReport[]).filter((r) => r.project_id === null || ids.has(r.project_id));
  const scopes = latestByScope(rows);
  const paths = Object.values(scopes).flatMap((s) => s.done?.result?.posts.flatMap((p) => p.images) ?? []);
  return { ready: true, scopes, images: await signedUrls(paths, 3600) };
}

/** 某個專案最新一份報告的結果（給「AI 排這週」參考）；沒有就 null */
export async function latestPatrolResult(projectId: string): Promise<PatrolResult | null> {
  const { data, error } = await db().from("patrol_reports").select("result").eq("project_id", projectId).eq("status", "done").order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return ((data ?? []) as { result: PatrolResult | null }[])[0]?.result ?? null;
}
