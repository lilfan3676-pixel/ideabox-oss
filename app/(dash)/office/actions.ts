"use server";

import { requireOwner } from "@/lib/auth";
import { endSession, setSessionRole } from "@/lib/office";

/** 清單上的「請他下班」：Claude 已經關掉但沒回報時手動移除 */
export async function dismissSession(id: string): Promise<void> {
  await requireOwner();
  await endSession(id);
}

/** 清單上點職位手動改；回傳 locked=false 代表還沒執行 migration-018 */
export async function changeSessionRole(id: string, role: string): Promise<{ ok: boolean; locked: boolean }> {
  await requireOwner();
  return setSessionRole(id, role);
}
