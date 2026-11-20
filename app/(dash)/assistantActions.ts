"use server";

import { requireOwner } from "@/lib/auth";
import { homeData } from "@/lib/app";
import { assistantLines, type AssistantLine } from "@/lib/assistantLogic";
import { getLang } from "@/lib/i18nServer";

/** 網站右下角小助手要講的話（只有主人看得到小助手）：跟手機 App「今天」同一份資料 */
export async function assistantLinesAction(): Promise<AssistantLine[]> {
  await requireOwner();
  const d = await homeData();
  const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return assistantLines(d, nowHm, (await getLang()) === "en" ? "en" : "zh");
}
