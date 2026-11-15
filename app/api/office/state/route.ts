import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listOffice } from "@/lib/office";

// 辦公室畫面輪詢用。用一般 GET 而不是 server action：server action 會跟換頁排在同一個佇列，
// 剛好在抓資料時切頁面就得等它跑完，所以有時候會卡一下。
export const dynamic = "force-dynamic";

export async function GET() {
  await requireOwner();
  const now = Date.now();
  const { sessions } = await listOffice(now);
  return NextResponse.json({ sessions, now }, { headers: { "Cache-Control": "no-store" } });
}
