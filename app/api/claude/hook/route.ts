import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { recordHook } from "@/lib/office";
import type { HookPayload } from "@/lib/officeLogic";
import { logError } from "@/lib/sysLog";

// 電腦上的 Claude Code hook 把狀態送來這裡（辦公室畫面用）。密鑰放在 Vercel 的 CLAUDE_HOOK_SECRET，
// 電腦那邊放在 ~/.claude/ideabox-hook.secret。沒設定就整個關閉。
export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  const secret = env.claudeHookSecret();
  if (!secret) return NextResponse.json({ ok: false }, { status: 404 });
  if (!safeEqual(req.headers.get("x-ideabox-hook") ?? "", secret)) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as HookPayload | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    const later = await recordHook(body);
    if (later) after(() => later().catch((err) => logError("office", err)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("office hook failed", err);
    await logError("office", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
