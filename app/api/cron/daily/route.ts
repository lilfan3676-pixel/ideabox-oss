import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { taipeiWeekday } from "@/lib/dates";
import { db, type Idea } from "@/lib/db";
import { sendWeeklyDigest } from "@/lib/digest";
import { env } from "@/lib/env";
import { runGrantRadar, sendDeadlineReminders } from "@/lib/grants";
import { reanalyze } from "@/lib/ideas";
import { logRun } from "@/lib/sysLog";
import { esc, sendToOwner } from "@/lib/telegram";

// 每天台北時間 21:00 左右由 Vercel Cron 呼叫（vercel.json：UTC 13:00）
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.cronSecret()}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const force = req.nextUrl.searchParams.get("force"); // 手動測試用：?force=sunday
  const isSunday = taipeiWeekday() === 0 || force === "sunday";
  const report: Record<string, unknown> = {};
  const t0 = Date.now();

  // 1. 重試 AI 分析失敗、或卡在「分析中」超過 10 分鐘的點子（最多 3 次）
  try {
    const stuckBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data } = await db()
      .from("ideas")
      .select("*")
      .in("status", ["failed", "pending"])
      .lt("created_at", stuckBefore)
      .lt("analyze_attempts", 3)
      .limit(10);
    let retried = 0;
    for (const idea of (data ?? []) as Idea[]) {
      const r = await reanalyze(idea);
      if (r.status === "analyzed") retried++;
    }
    report.retried = retried;
  } catch (err) {
    report.retryError = String(err);
  }

  // 2. 週日：先把這週的修正整理成規則（補助雷達會用到），再更新補助雷達、發週報
  if (isSunday) {
    try {
      const { runLearning } = await import("@/lib/learning");
      report.learning = await runLearning();
    } catch (err) {
      report.learningError = String(err);
    }
  }
  // 週日：先更新補助雷達，再發週報（週報會帶到最新的截止清單）
  if (isSunday) {
    try {
      const r = await runGrantRadar();
      report.radar = r;
      if (r.added > 0) await sendToOwner(`🔎 補助雷達更新：新增 ${r.added} 筆、更新 ${r.updated} 筆，到主控台看看。`);
    } catch (err) {
      report.radarError = String(err);
      await sendToOwner(`⚠️ 補助雷達這次執行失敗：${esc(String(err).slice(0, 200))}`);
    }
    try {
      report.digest = await sendWeeklyDigest();
      await logRun("weekly_digest", report.digest === true, report.digest === true ? null : "Telegram 沒有成功送出");
    } catch (err) {
      report.digestError = String(err);
      await logRun("weekly_digest", false, String(err));
    }
  }

  // 3. 模組（lib/modules）的每日工作
  const { modules } = await import("@/lib/modules/registry");
  for (const m of modules()) {
    if (!m.daily) continue;
    try {
      report[m.key] = await m.daily({ isSunday });
    } catch (err) {
      report[`${m.key}Error`] = String(err);
    }
  }

  // 4. 產品監控（5 分鐘排程的備援）
  try {
    const { runMonitor } = await import("@/lib/monitor");
    report.monitor = await runMonitor({ notify: true });
  } catch (err) {
    report.monitorError = String(err);
  }

  // 5. 成本：匯率、扣款日、續約提醒
  try {
    const { runCostDaily } = await import("@/lib/costs");
    report.costs = await runCostDaily();
  } catch (err) {
    report.costError = String(err);
  }

  // 5c. 清掉 7 天前沒按的 Telegram 按鈕資料
  try {
    const { cleanupTokens } = await import("@/lib/tgFlow");
    await cleanupTokens();
    const { cleanupSessions } = await import("@/lib/office");
    await cleanupSessions();
  } catch (err) {
    report.tgCleanupError = String(err);
  }

  // 6. 每天：截止日提醒
  try {
    report.reminders = await sendDeadlineReminders();
  } catch (err) {
    report.reminderError = String(err);
  }

  // 記錄這次執行（健康檢查用）：任何一段出錯都算部分失敗
  const errors = Object.entries(report).filter(([k]) => k.endsWith("Error")).map(([k, v]) => `${k.replace(/Error$/, "")}: ${String(v).slice(0, 80)}`);
  await logRun("daily", errors.length === 0, errors.join("；") || null, Date.now() - t0);
  return NextResponse.json({ ok: true, ...report });
}
