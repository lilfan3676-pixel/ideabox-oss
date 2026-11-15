import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cleanSupabaseUrl } from "./lib/env";

// 每次請求刷新 Supabase 登入狀態；未登入就導到 /login。
// 真正的權限檢查（是否為主人 Email）在每個頁面與 server action 的 requireOwner() 裡。
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = rawUrl ? cleanSupabaseUrl(rawUrl) : undefined;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // getClaims：驗證並在需要時刷新登入憑證（新版專案可在本機驗證，比 getUser 快）
  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!data?.claims && !isLogin) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return response;
}

export const config = {
  // API（Telegram webhook、Cron）有自己的驗證，不經過登入檢查；brand／fonts 是公開的主題素材（登入頁也要用）
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|fonts/).*)"],
};
