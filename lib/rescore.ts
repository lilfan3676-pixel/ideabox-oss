import "server-only";
import { db, type Idea } from "./db";
import { reanalyze } from "./ideas";
import { isOldScoring } from "./scoring";
import { logError } from "./sysLog";

// 舊點子用新評分重評：只重評「分析好、還沒採用」而且是舊算法評的。
// 分類、資料夾、重複標記都不動（reanalyze 的 keepFiling），只換分數、理由、下一步。
// 進度記在 settings.rescore_job；網頁開著時一批一批接著跑，關掉了每日排程會接手。

const KEY = "rescore_job";
/** 一批跑多久就收工（毫秒）；網頁那邊會再叫下一批 */
export const BATCH_MS = 80_000;
/** 幾分鐘內有心跳算「正在跑」 */
const ALIVE_MS = 3 * 60_000;

/** skip：這一輪評失敗的點子 id（排到最後、這一輪不再試，免得幾則固定失敗的卡住後面全部）；使用者再按一次「重評」就清掉重來 */
export type RescoreJob = { on: boolean; at: number; done: number; failed: number; skip?: string[] };
export type RescoreStatus = { ready: boolean; pending: number; running: boolean; on: boolean; done: number; failed: number };

async function readJob(): Promise<RescoreJob | null> {
  const { data } = await db().from("settings").select("value").eq("key", KEY).maybeSingle();
  try {
    return data?.value ? (JSON.parse(String(data.value)) as RescoreJob) : null;
  } catch {
    return null;
  }
}

async function writeJob(job: RescoreJob) {
  await db().from("settings").upsert({ key: KEY, value: JSON.stringify(job), updated_at: new Date().toISOString() });
}

/** 還沒用新算法評過的點子（新的排前面）。還沒執行 migration-033 時 ready=false */
export async function pendingRescore(): Promise<{ ready: boolean; ideas: Idea[] }> {
  const probe = await db().from("ideas").select("id, scoring").limit(1);
  if (probe.error) return { ready: false, ideas: [] };
  const { data } = await db().from("ideas").select("*").eq("status", "analyzed").eq("adopted", false).order("created_at", { ascending: false }).limit(1000);
  return { ready: true, ideas: ((data ?? []) as Idea[]).filter((i) => isOldScoring(i.scoring)) };
}

export async function rescoreStatus(): Promise<RescoreStatus> {
  const [{ ready, ideas }, job] = await Promise.all([pendingRescore(), readJob()]);
  const running = !!job?.on && Date.now() - job.at < ALIVE_MS && ideas.length > 0;
  return { ready, pending: ideas.length, running, on: !!job?.on, done: job?.done ?? 0, failed: job?.failed ?? 0 };
}

/** 跑一批：最多 max 則或 budgetMs 毫秒。連續失敗 3 則就停（多半是 AI 服務有狀況） */
export async function rescoreBatch(max = 40, budgetMs = BATCH_MS): Promise<{ done: number; failed: number; left: number }> {
  const t0 = Date.now();
  const { ready, ideas } = await pendingRescore();
  if (!ready) return { done: 0, failed: 0, left: 0 };
  const prev = await readJob();
  // 別的請求正在跑（2 分鐘內有心跳；每則開始前和結束後都會打）就不重複跑
  if (prev?.on && Date.now() - prev.at < 120_000) return { done: 0, failed: 0, left: ideas.length };
  const base = prev?.on ? { done: prev.done, failed: prev.failed } : { done: 0, failed: 0 };
  const skip = new Set(prev?.on ? (prev.skip ?? []) : []);
  const queue = ideas.filter((i) => !skip.has(i.id));
  let done = 0;
  let failed = 0;
  let streak = 0;
  const beat = (on: boolean, at = Date.now()) => writeJob({ on, at, done: base.done + done, failed: base.failed + failed, skip: [...skip].slice(-300) });
  await beat(true);
  for (const idea of queue.slice(0, max)) {
    if (Date.now() - t0 > budgetMs || streak >= 3) break;
    await beat(true);
    let ok = false;
    try {
      ok = (await reanalyze(idea, { keepFiling: true })).status === "analyzed";
      // 重評失敗：把原本分析好的狀態放回去，舊分數照舊可以看
      if (!ok) await db().from("ideas").update({ status: "analyzed", analyze_attempts: idea.analyze_attempts }).eq("id", idea.id);
    } catch (err) {
      await logError("idea_rescore", err);
    }
    if (ok) {
      done++;
      streak = 0;
    } else {
      failed++;
      streak++;
      skip.add(idea.id);
    }
    await beat(true);
  }
  const left = ideas.length - done;
  // 還有沒試過的而且不是連續失敗（多半是 AI 服務有狀況）：保持開著，心跳往回撥讓下一批馬上接手；否則收工
  const stillOn = queue.length - done - failed > 0 && streak < 3;
  await beat(stillOn, stillOn ? Date.now() - ALIVE_MS : Date.now());
  return { done, failed, left };
}
