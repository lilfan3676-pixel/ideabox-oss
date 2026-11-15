import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runHealthCheck } from "@/lib/health";
import { track } from "@/lib/sysLog";

// ideabox 的 Supabase 每週一台北 09:00 呼叫（pg_cron），密鑰與監控共用
export const maxDuration = 60;
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
    const r = await track("health", () => runHealthCheck({ notify: true }));
    return NextResponse.json({ ok: true, issues: r.issues.length });
  } catch (err) {
    console.error("health tick", err);
    return NextResponse.json({ ok: false, error: String(err).slice(0, 200) }, { status: 500 });
  }
}
