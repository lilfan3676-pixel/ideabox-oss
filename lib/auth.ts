import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "./env";
import { accessOf, can, editsProject, homeHref, OWNER_ACCESS, type Access, type Member, type PageKey } from "./accessLogic";
import { activeMemberByEmail } from "./members";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // 在 Server Component 裡不能寫 cookie；session 會由 proxy.ts 負責刷新
        }
      },
    },
  });
}

/** 讀取目前登入者的 Email。用 getClaims 驗證登入憑證（簽章有效才會回傳），
 *  新版 Supabase 專案可在本機驗證、不必每次連線；同一次請求內只驗證一次。 */
const currentUser = cache(async (): Promise<{ email: string; id: string } | null> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getClaims();
  if (error || !data?.claims) return null;
  const { email, sub } = data.claims as { email?: string; sub?: string };
  return email ? { email: email.toLowerCase(), id: String(sub ?? "") } : null;
});

/** 目前登入的是誰：主人、合夥人（有權限設定），或沒登入／沒權限（null）。同一次請求內只查一次 */
export const getViewer = cache(async (): Promise<{ email: string; access: Access; member: Member | null } | null> => {
  const user = await currentUser();
  if (!user) return null;
  const { email } = user;
  if (email === env.ownerEmail()) return { email, access: OWNER_ACCESS, member: null };
  const member = await activeMemberByEmail(email);
  // 除了 Email，還要是用邀請連結設好密碼的那個登入帳號（避免別人先用他的 Email 註冊）
  return member && member.user_id && member.user_id === user.id ? { email, access: accessOf(member), member } : null;
});

/** 確認目前登入者是主人，否則導回登入頁（合夥人導回他的首頁）。主人專用的頁面與 server action 都要呼叫。 */
export async function requireOwner(): Promise<{ email: string }> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.access.owner) redirect(homeHref(v.access));
  return { email: v.email };
}

/** 主人，或有這個畫面權限的合夥人；沒有就導回他的首頁 */
export async function requirePage(...pages: PageKey[]): Promise<{ email: string; access: Access }> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.access.owner && !pages.some((p) => can(v.access, p))) redirect(homeHref(v.access));
  return { email: v.email, access: v.access };
}

/** 登入就好（主人或合夥人），給版面與共用的 server action 用 */
export async function requireViewer(): Promise<{ email: string; access: Access }> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return { email: v.email, access: v.access };
}

/** 在某個專案裡編輯（勾里程碑、排程、日誌）：主人，或這個專案「可編輯」的合夥人。沒權限丟錯，不導頁 */
export async function requireProjectEdit(projectId: string | null | undefined): Promise<Access> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!editsProject(v.access, projectId)) throw new Error("沒有權限");
  return v.access;
}
