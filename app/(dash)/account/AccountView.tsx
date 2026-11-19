"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useL } from "@/app/LangProvider";
import { MIN_PASSWORD } from "@/lib/accessLogic";
import { AppPairing } from "../settings/AppPairing";
import { changeMyPassword, createMyPairing, removeMyDevice, setMyPush, type PwResult } from "./actions";

type Device = { id: string; name: string; push_token: string | null; last_seen_at: string; created_at: string };

const fmt = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function AccountView({ name, email, canEdit, push, projects, pages, devices }: {
  name: string;
  email: string;
  canEdit: boolean;
  push: boolean;
  projects: string[];
  pages: string[];
  devices: Device[];
}) {
  const L = useL();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pushOn, setPushOn] = useState(push);
  const [pw, setPw] = useState<PwResult | null>(null);
  const form = useRef<HTMLFormElement>(null);

  const pwError: Record<string, string> = {
    weak: L(`新密碼至少 ${MIN_PASSWORD} 個字`, `At least ${MIN_PASSWORD} characters`),
    same: L("新密碼跟目前的一樣", "That's your current password"),
    wrong: L("目前的密碼不對", "Current password is wrong"),
    mismatch: L("兩次輸入的新密碼不一樣", "The new passwords don't match"),
    failed: L("更新失敗，請稍後再試", "Couldn't update. Try again later"),
  };

  return (
    <div className="account-page">
      <div className="account-col">
        <section className="glass panel">
          <h3>{name}</h3>
          <p className="muted small">{email}・{canEdit ? L("可編輯", "Can edit") : L("只看", "View only")}</p>
          <p className="muted small account-label">{L("能看的專案", "Projects")}</p>
          <div className="account-chips">{projects.map((p) => <span key={p}>{p}</span>)}</div>
          <p className="muted small account-label">{L("能進的畫面", "Screens")}</p>
          <div className="account-chips">{pages.map((p) => <span key={p}>{p}</span>)}</div>
          <p className="muted small">{L("要調整權限請找帳號主人。", "Ask the account owner to change access.")}</p>
        </section>

        <section className="glass panel">
          <h3>{L("改密碼", "Change password")}</h3>
          <form
            ref={form}
            className="account-form"
            action={(fd) =>
              start(async () => {
                const r = await changeMyPassword(fd).catch((): PwResult => ({ ok: false, error: "failed" }));
                setPw(r);
                if (r.ok) form.current?.reset();
              })
            }
          >
            <input type="password" name="current" autoComplete="current-password" placeholder={L("目前的密碼", "Current password")} required />
            <input type="password" name="next" autoComplete="new-password" minLength={MIN_PASSWORD} placeholder={L(`新密碼（至少 ${MIN_PASSWORD} 個字）`, `New password (${MIN_PASSWORD}+ characters)`)} required />
            <input type="password" name="again" autoComplete="new-password" minLength={MIN_PASSWORD} placeholder={L("再輸入一次新密碼", "New password again")} required />
            {pw && !pw.ok && <p className="error small" role="alert">{pwError[pw.error]}</p>}
            {pw?.ok && <p className="muted small" role="status">✓ {L("密碼已更新，下次登入用新密碼", "Password updated")}</p>}
            <button type="submit" className="btn primary" disabled={pending}>{pending ? L("更新中…", "Updating…") : L("更新密碼", "Update password")}</button>
          </form>
        </section>
      </div>

      <div className="account-col">
        <section className="glass panel">
          <h3>{L("手機 App", "Phone app")}</h3>
          {devices.length > 0 && (
            <ul className="status-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <span>
                    <b>{d.name}</b>
                    <span className="muted small">　{L("配對於", "Paired")} {fmt(d.created_at)}・{L("最後使用", "Last seen")} {fmt(d.last_seen_at)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={pending}
                    onClick={() => window.confirm(L(`解除「${d.name}」？這支手機會被登出。`, `Unpair “${d.name}”?`)) && start(async () => { await removeMyDevice(d.id); router.refresh(); })}
                  >
                    {L("解除", "Unpair")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AppPairing create={createMyPairing} label={L("連結一支手機", "Pair a phone")} />
          <p className="muted small">{L("ideabox App 要先從 TestFlight 安裝，再用 App 掃描 QR code 或手動輸入配對碼。", "Install the ideabox app from TestFlight first, then scan the QR code or enter the code.")}</p>
        </section>

        <section className="glass panel">
          <div className="account-toggle">
            <h3 id="push-h">{L("推送通知", "Push notifications")}</h3>
            <input
              aria-labelledby="push-h"
              type="checkbox"
              role="switch"
              checked={pushOn}
              disabled={pending}
              onChange={(e) => {
                const on = e.target.checked;
                setPushOn(on);
                start(async () => {
                  await setMyPush(on).catch(() => setPushOn(!on));
                  router.refresh();
                });
              }}
            />
          </div>
          <p className="muted small">{L("會收到（只限你看得到的專案）：", "You'll get (your projects only):")}</p>
          <ul className="account-list muted small">
            <li>{L("早上 8 點今日排程與里程碑", "Today's schedule at 8 am")}</li>
            <li>{L("里程碑前 7 天／1 天", "Milestones 7 / 1 days before")}</li>
            <li>{L("有時間的排程開始前 30 分鐘", "30 min before timed items")}</li>
            <li>{L("產品掛掉／恢復（有產品監控畫面才會）", "Product down / back up (with Monitor access)")}</li>
          </ul>
          {pushOn && !devices.some((d) => d.push_token) && (
            <p className="muted small">{L("還沒有手機開啟通知：配對後在 App 裡允許通知才收得到。", "No phone has notifications on yet: allow them in the app after pairing.")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
