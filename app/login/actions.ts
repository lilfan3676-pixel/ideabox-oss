"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/auth";
import { env } from "@/lib/env";
import { accessOf, homeHref, MIN_PASSWORD } from "@/lib/accessLogic";
import { acceptInvite, activeMemberByEmail, markMemberLogin } from "@/lib/members";

export async function login(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // 主人或啟用中的合夥人才能登入
  const member = email === env.ownerEmail() ? null : await activeMemberByEmail(email);
  if (email !== env.ownerEmail() && !member) redirect("/login?error=denied");
  const sb = await supabaseServer();
  const { data: signed, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("login failed:", error.status, error.code, error.message);
    redirect(`/login?error=invalid&reason=${encodeURIComponent(error.code || error.message || "")}`);
  }
  if (member && member.user_id !== signed.user?.id) {
    // 不是邀請連結建立的那個帳號
    await sb.auth.signOut();
    redirect("/login?error=denied");
  }
  if (member) {
    await markMemberLogin(email);
    redirect(homeHref(accessOf(member)));
  }
  redirect("/");
}

/** 合夥人用邀請連結設密碼，設好直接登入 */
export async function acceptInviteAction(form: FormData) {
  const token = String(form.get("t") ?? "");
  const password = String(form.get("password") ?? "");
  const again = String(form.get("again") ?? "");
  const back = (e: string) => redirect(`/join?t=${encodeURIComponent(token)}&error=${e}`);
  if (password.length < MIN_PASSWORD) back("weak");
  if (password !== again) back("mismatch");
  const r = await acceptInvite(token, password);
  if (!r.ok) back(r.error);
  const email = (r as { email: string }).email;
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) redirect("/login");
  const member = await activeMemberByEmail(email);
  await markMemberLogin(email);
  redirect(member ? homeHref(accessOf(member)) : "/login");
}

export async function logout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
