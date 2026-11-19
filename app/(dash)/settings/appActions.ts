"use server";
// 設定頁「手機 App」：產生配對 QR code、解除配對
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { removeDevice } from "@/lib/app";
import { makePairing, type PairResult } from "@/lib/pairing";

export type { PairResult };

/** memberId：替合夥人配對他的手機（只看得到他有權限的東西） */
export async function createAppPairing(memberId?: string): Promise<PairResult> {
  await requireOwner();
  return makePairing(memberId && /^[0-9a-f-]{36}$/i.test(memberId) ? memberId : null);
}

export async function removeAppDevice(id: string): Promise<void> {
  await requireOwner();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await removeDevice(id);
  revalidatePath("/settings");
}
