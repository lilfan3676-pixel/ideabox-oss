"use server";
// 合夥人的「我的帳號」：改密碼、配對／解除自己的手機、推送開關（權限設定只有主人能改）
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getViewer } from "@/lib/auth";
import { env } from "@/lib/env";
import { changeMemberPassword, removeMemberDevice, setMemberPush } from "@/lib/members";
import { makePairing, type PairResult } from "@/lib/pairing";

async function me() {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.member) redirect("/settings"); // 主人用設定頁
  return v.member;
}

/** 用另一個不存 cookie 的連線試登入一次，確認目前的密碼對（不影響現在的登入狀態） */
async function verifyPassword(email: string, password: string): Promise<string | null> {
  const sb = createClient(env.supabaseUrl(), env.supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return null;
  await sb.auth.signOut({ scope: "local" }).catch(() => null);
  return data.user.id;
}

export type PwResult = { ok: true } | { ok: false; error: "weak" | "same" | "wrong" | "failed" | "mismatch" };

export async function changeMyPassword(form: FormData): Promise<PwResult> {
  const m = await me();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("again") ?? "")) return { ok: false, error: "mismatch" };
  return changeMemberPassword(m, current, next, verifyPassword);
}

export async function createMyPairing(): Promise<PairResult> {
  const m = await me();
  return makePairing(m.id);
}

export async function removeMyDevice(id: string): Promise<void> {
  const m = await me();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await removeMemberDevice(m.id, id);
  revalidatePath("/account");
}

export async function setMyPush(on: boolean): Promise<void> {
  const m = await me();
  await setMemberPush(m.id, on === true);
  revalidatePath("/account");
}
