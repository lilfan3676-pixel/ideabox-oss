import { getL } from "@/lib/i18nServer";
import { LogoMark } from "../LogoMark";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

// 合夥人帳號還沒開任何畫面
export default async function NoAccessPage() {
  const L = await getL();
  return (
    <main className="app-bg login">
      <form action={logout} className="glass login-card page-enter">
        <div className="logo big" aria-hidden="true">
          <LogoMark size={26} />
        </div>
        <h1>{L("還沒有開放任何畫面", "Nothing is shared with you yet")}</h1>
        <p className="muted">{L("請邀請你的人在 ideabox 設定頁替你勾選能看的畫面與專案。", "Ask the person who invited you to pick screens and projects for you.")}</p>
        <button type="submit" className="btn">{L("登出", "Sign out")}</button>
      </form>
    </main>
  );
}
