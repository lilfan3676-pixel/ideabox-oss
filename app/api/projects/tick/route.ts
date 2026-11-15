import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { taipeiWeekday } from "@/lib/dates";
import { db } from "@/lib/db";
import { runProjectTick } from "@/lib/projects";
import { track } from "@/lib/sysLog";

// ideabox 的 Supabase 每天台北 08:00 呼叫（pg_cron），密鑰與監控共用。
// 週日另外在背景跑話題雷達（Apify 抓 Threads＋AI 整理，最多幾分鐘），所以上限開到 300 秒。
export const maxDuration = 300;
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
    const r = await track("projects", () => runProjectTick());
    if (taipeiWeekday() === 0 || req.nextUrl.searchParams.get("force") === "radar") {
      after(async () => {
        const { runWeeklyRadar } = await import("@/lib/radar");
        await runWeeklyRadar().catch((err) => console.error("radar", err));
      });
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("projects tick", err);
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
