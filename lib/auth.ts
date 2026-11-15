import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "./env";

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
const currentEmail = cache(async (): Promise<string | null> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getClaims();
  if (error || !data?.claims) return null;
  const email = (data.claims as { email?: string }).email;
  return email ? email.toLowerCase() : null;
});

/** 確認目前登入者是主人，否則導回登入頁。每個頁面與 server action 都要呼叫。 */
export async function requireOwner(): Promise<{ email: string }> {
  const email = await currentEmail();
  if (!email || email !== env.ownerEmail()) redirect("/login");
  return { email };
}
