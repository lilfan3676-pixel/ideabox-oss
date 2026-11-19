import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { runMonitor } from "@/lib/monitor";
import { runSlackSync } from "@/lib/slack";
import { track } from "@/lib/sysLog";
import { runEventReminders } from "@/lib/app";
import { runPostReminders } from "@/lib/posts";

// ideabox 自己的 Supabase 每 5 分鐘呼叫一次（pg_cron），密鑰存在 settings 表
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const { data } = await db().from("settings").select("value").eq("key", "monitor_tick_secret").maybeSingle();
  const secret = (data as { value: string } | null)?.value ?? "";
  if (!secret || !safeEqual(req.headers.get("x-monitor-secret") ?? "", secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const r = await track("monitor", () => runMonitor({ notify: true }));
    // 順便讀 Slack 的專案進度回報（沒設定就略過；失敗不影響監控）
    const slack = env.slackBotToken() ? await track("slack", () => runSlackSync()).catch((e) => ({ error: String(e).slice(0, 120) })) : null;
    // 手機 App：有填時間的排程，開始前 30 分鐘推送（沒配對手機就什麼都不做）
    const reminders = await runEventReminders().catch((e) => { console.error("event reminders", e); return 0; });
    // 發文排程：時間到的貼文，把文案傳到 Telegram（還沒執行 migration-028 就什麼都不做）
    const posts = await runPostReminders().catch((e) => { console.error("post reminders", e); return 0; });
    return NextResponse.json({ ok: true, ...r, slack, reminders, posts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
