"use server";
// 設定頁「合夥人」：邀請、改權限、重新產生邀請連結、停用、刪除（只有你能用）
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { cleanMember } from "@/lib/accessLogic";
import { env } from "@/lib/env";
import { getL } from "@/lib/i18nServer";
import { createMember, deleteMember, resetInvite, setMemberActive, updateMember } from "@/lib/members";
import { listProjects } from "@/lib/projects";

export type MemberForm = { name: string; email?: string; projects: string[]; pages: string[]; canEdit: boolean; push: boolean };
export type MemberResult = { ok: true; link?: string; id?: string } | { ok: false; error: string };

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

async function inviteLink(token: string): Promise<string> {
  let base = env.appUrl().replace(/\/+$/, "");
  if (!base) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    base = `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  }
  return `${base}/join?t=${token}`;
}

async function check(v: MemberForm, needEmail: boolean) {
  const L = await getL();
  const { projects } = await listProjects();
  const c = cleanMember(v, env.ownerEmail(), projects.map((p) => p.id), needEmail);
  return "error" in c ? { error: L(...c.error) } : { ok: c };
}

export async function inviteMemberAction(v: MemberForm): Promise<MemberResult> {
  await requireOwner();
  const L = await getL();
  const c = await check(v, true);
  if (!c.ok) return { ok: false, error: c.error! };
  const r = await createMember(c.ok);
  if ("error" in r) return { ok: false, error: r.error === "exists" ? L("這個 Email 已經邀請過了", "This email was already invited") : L("請先在 ideabox 的 Supabase 執行 migration-026-members.sql", "Run migration-026-members.sql first") };
  revalidatePath("/settings");
  return { ok: true, link: await inviteLink(r.token), id: r.id };
}

export async function updateMemberAction(id: string, v: MemberForm): Promise<MemberResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false, error: "id" };
  const c = await check(v, false);
  if (!c.ok) return { ok: false, error: c.error! };
  const { email: _email, ...rest } = c.ok;
  await updateMember(id, rest);
  revalidatePath("/settings");
  return { ok: true };
}

export async function resetInviteAction(id: string): Promise<MemberResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false, error: "id" };
  const token = await resetInvite(id);
  revalidatePath("/settings");
  return { ok: true, link: await inviteLink(token) };
}

export async function setMemberActiveAction(id: string, active: boolean): Promise<MemberResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false, error: "id" };
  await setMemberActive(id, !!active);
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteMemberAction(id: string): Promise<MemberResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false, error: "id" };
  await deleteMember(id);
  revalidatePath("/settings");
  return { ok: true };
}
