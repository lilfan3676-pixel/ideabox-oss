import { getL } from "@/lib/i18nServer";
import { LogoMark } from "../LogoMark";
import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { error, reason } = await searchParams;
  const L = await getL();
  return (
    <main className="app-bg login">
      <form action={login} className="glass login-card page-enter">
        <div className="logo big" aria-hidden="true">
          <LogoMark size={26} />
        </div>
        <h1>ideabox</h1>
        <p className="muted">{L("創業家主控台", "Founder console")}</p>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          {L("密碼", "Password")}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error === "denied" ? L("這個帳號沒有權限", "This account doesn't have access") : L("Email 或密碼錯誤", "Wrong email or password")}</p>}
        {reason && <p className="muted small">{L("錯誤代碼：", "Error code: ")}{reason.slice(0, 80)}</p>}
        <button type="submit" className="btn primary">{L("登入", "Sign in")}</button>
      </form>
    </main>
  );
}
