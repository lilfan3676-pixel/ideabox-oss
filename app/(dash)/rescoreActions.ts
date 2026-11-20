"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { rescoreBatch, rescoreStatus, type RescoreStatus } from "@/lib/rescore";

/** 舊點子用新評分重評：在背景跑一批（網頁會一批一批接著叫，直到評完） */
export async function startRescore(): Promise<RescoreStatus> {
  await requireOwner();
  const status = await rescoreStatus();
  if (!status.ready || !status.pending || status.running) return status;
  after(async () => {
    await rescoreBatch().catch(() => null);
    revalidatePath("/");
  });
  return { ...status, on: true, running: true };
}

export async function rescoreStatusAction(): Promise<RescoreStatus> {
  await requireOwner();
  return rescoreStatus();
}
