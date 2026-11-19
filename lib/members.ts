import "server-only";
// 合夥人帳號：邀請連結、設密碼、權限。還沒執行 migration-026 時讀取一律當作沒有合夥人、不丟錯。
import { db } from "./db";
import { INVITE_TTL_MS, MIN_PASSWORD, type CleanMember, type Member } from "./accessLogic";
import { newDeviceToken, sha256 } from "./appLogic";

const COLS = "id, email, name, project_ids, pages, can_edit, push, active, user_id, invite_exp, last_login_at, created_at";

export async function activeMemberByEmail(email: string): Promise<Member | null> {
  const { data, error } = await db().from("members").select(COLS).eq("email", email.toLowerCase()).eq("active", true).maybeSingle();
  if (error || !data) return null;
  return data as Member;
}

export async function getMember(id: string): Promise<Member | null> {
  const { data, error } = await db().from("members").select(COLS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as Member;
}

export async function listMembers(): Promise<{ members: Member[]; ready: boolean }> {
  const { data, error } = await db().from("members").select(COLS).order("created_at", { ascending: true });
  if (error) return { members: [], ready: false };
  return { members: (data ?? []) as Member[], ready: true };
}

/** 產生新的邀請連結（舊的作廢）。回傳連結裡的密碼（只有這一次看得到原文） */
async function newInvite(memberId: string, now = Date.now()): Promise<string> {
  const token = newDeviceToken();
  const { error } = await db().from("members").update({ invite_hash: sha256(token), invite_exp: new Date(now + INVITE_TTL_MS).toISOString() }).eq("id", memberId);
  if (error) throw error;
  return token;
}

export async function createMember(v: CleanMember, now = Date.now()): Promise<{ id: string; token: string } | { error: "exists" | "not_ready" }> {
  const { data: dup, error: e1 } = await db().from("members").select("id").eq("email", v.email).maybeSingle();
  if (e1) return { error: "not_ready" };
  if (dup) return { error: "exists" };
  const { data, error } = await db().from("members").insert(v).select("id").single();
  if (error || !data) return { error: "not_ready" };
  const id = (data as { id: string }).id;
  return { id, token: await newInvite(id, now) };
}

export async function updateMember(id: string, v: Omit<CleanMember, "email">): Promise<void> {
  const { error } = await db().from("members").update(v).eq("id", id);
  if (error) throw error;
}

/** 重新產生邀請連結：還沒設密碼的人重寄、忘記密碼的人重設 */
export async function resetInvite(id: string, now = Date.now()): Promise<string> {
  return newInvite(id, now);
}

/** 停用：不能登入、手機一起解除；恢復時手機要重新配對 */
export async function setMemberActive(id: string, active: boolean): Promise<void> {
  await db().from("members").update(active ? { active } : { active, invite_hash: null, invite_exp: null }).eq("id", id);
  if (!active) await db().from("app_devices").delete().eq("member_id", id);
}

/** 刪除合夥人（手機一起解除）；他的 Supabase 登入帳號也刪掉 */
export async function deleteMember(id: string): Promise<void> {
  const m = await getMember(id);
  await db().from("members").delete().eq("id", id);
  if (m?.user_id) await db().auth.admin.deleteUser(m.user_id).catch(() => null);
}

/** 邀請連結對應的合夥人；過期、用過、停用的都回傳 null */
export async function memberByInvite(token: unknown, now = Date.now()): Promise<Member | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const { data, error } = await db().from("members").select(COLS).eq("invite_hash", sha256(token)).eq("active", true).maybeSingle();
  if (error || !data) return null;
  const m = data as Member;
  if (!m.invite_exp || Date.parse(m.invite_exp) < now) return null;
  return m;
}

/** 用邀請連結設密碼：沒有登入帳號就建立，有就改密碼；成功後連結作廢 */
export async function acceptInvite(token: unknown, password: string, now = Date.now()): Promise<{ ok: true; email: string } | { ok: false; error: "invalid" | "weak" | "failed" }> {
  if (password.length < MIN_PASSWORD) return { ok: false, error: "weak" };
  const m = await memberByInvite(token, now);
  if (!m) return { ok: false, error: "invalid" };
  const admin = db().auth.admin;
  let userId = m.user_id;
  if (userId) {
    const { error } = await admin.updateUserById(userId, { password });
    if (error) userId = null; // 帳號在後台被刪掉了：下面重建
  }
  if (!userId) {
    const { data, error } = await admin.createUser({ email: m.email, password, email_confirm: true });
    if (data?.user) userId = data.user.id;
    else if (error) {
      // 這個 Email 已經有登入帳號（例如之前刪掉合夥人後又加回來）：找出來改密碼
      userId = await findUserId(m.email);
      if (!userId) return { ok: false, error: "failed" };
      const { error: e2 } = await admin.updateUserById(userId, { password, email_confirm: true });
      if (e2) return { ok: false, error: "failed" };
    }
  }
  await db().from("members").update({ user_id: userId, invite_hash: null, invite_exp: null }).eq("id", m.id);
  return { ok: true, email: m.email };
}

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function markMemberLogin(email: string): Promise<void> {
  await db().from("members").update({ last_login_at: new Date().toISOString() }).eq("email", email.toLowerCase());
}

// ---------- 合夥人自己的「我的帳號」 ----------

/** 推送開關（合夥人自己或主人在合夥人頁都改同一個欄位） */
export async function setMemberPush(id: string, push: boolean): Promise<void> {
  const { error } = await db().from("members").update({ push }).eq("id", id);
  if (error) throw error;
}

/** 解除自己的手機：只能刪掉屬於這個合夥人的那一支 */
export async function removeMemberDevice(memberId: string, deviceId: string): Promise<void> {
  await db().from("app_devices").delete().eq("id", deviceId).eq("member_id", memberId);
}

/** 改密碼：先用 verify 確認目前的密碼對，再改；verify 由呼叫端提供（實際是用 Supabase 登入試一次） */
export async function changeMemberPassword(
  m: Pick<Member, "email" | "user_id">,
  current: string,
  next: string,
  verify: (email: string, password: string) => Promise<string | null>,
): Promise<{ ok: true } | { ok: false; error: "weak" | "same" | "wrong" | "failed" }> {
  if (next.length < MIN_PASSWORD) return { ok: false, error: "weak" };
  if (next === current) return { ok: false, error: "same" };
  if (!m.user_id) return { ok: false, error: "failed" };
  const uid = await verify(m.email, current).catch(() => null);
  if (!uid || uid !== m.user_id) return { ok: false, error: "wrong" };
  const { error } = await db().auth.admin.updateUserById(m.user_id, { password: next });
  return error ? { ok: false, error: "failed" } : { ok: true };
}
