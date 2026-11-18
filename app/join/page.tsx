import { getL } from "@/lib/i18nServer";
import { MIN_PASSWORD } from "@/lib/accessLogic";
import { memberByInvite } from "@/lib/members";
import { LogoMark } from "../LogoMark";
import { acceptInviteAction } from "../login/actions";

export const dynamic = "force-dynamic";

// 合夥人的邀請連結：設好密碼就能登入（連結 7 天有效、用一次就失效）
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ t?: string; error?: string }> }) {
  const { t = "", error } = await searchParams;
  const L = await getL();
  const m = await memberByInvite(t).catch(() => null);
  const msg: Record<string, string> = {
    weak: L(`密碼至少 ${MIN_PASSWORD} 個字`, `Password needs at least ${MIN_PASSWORD} characters`),
    mismatch: L("兩次輸入的密碼不一樣", "Passwords don't match"),
    invalid: L("連結已失效", "This link has expired"),
    failed: L("設定失敗，請稍後再試或請對方重新產生連結", "Couldn't set the password. Try again later or ask for a new link"),
  };
  return (
    <main className="app-bg login">
      {m ? (
        <form action={acceptInviteAction} className="glass login-card page-enter">
          <div className="logo big" aria-hidden="true">
            <LogoMark size={26} />
          </div>
          <h1>{L(`歡迎，${m.name}`, `Welcome, ${m.name}`)}</h1>
          <p className="muted">{L("設定密碼後就能登入 ideabox，之後用這個 Email 和密碼登入。", "Set a password to sign in to ideabox. Use this email and password next time.")}</p>
          <input type="hidden" name="t" value={t} />
          <label>
            Email
            <input value={m.email} readOnly autoComplete="username" />
          </label>
          <label>
            {L("新密碼", "New password")}
            <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
          </label>
          <label>
            {L("再輸入一次", "Repeat password")}
            <input name="again" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
          </label>
          {error && <p className="error">{msg[error] ?? msg.failed}</p>}
          <button type="submit" className="btn primary">{L("設定密碼並登入", "Set password and sign in")}</button>
        </form>
      ) : (
        <div className="glass login-card page-enter">
          <div className="logo big" aria-hidden="true">
            <LogoMark size={26} />
          </div>
          <h1>{L("邀請連結已失效", "This invite has expired")}</h1>
          <p className="muted">{L("連結過期（7 天）、已經用過，或帳號被停用了。請邀請你的人重新產生一條連結。", "The link expired (7 days), was already used, or the account was turned off. Ask for a new link.")}</p>
          <a className="btn primary" href="/login">{L("前往登入", "Go to sign in")}</a>
        </div>
      )}
    </main>
  );
}
