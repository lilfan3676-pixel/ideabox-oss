"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useL } from "@/app/LangProvider";
import { MEMBER_PAGES, MEMBER_TEMPLATES, type Member } from "@/lib/accessLogic";
import { AppPairing } from "./AppPairing";
import { removeAppDevice } from "./appActions";
import { deleteMemberAction, inviteMemberAction, resetInviteAction, setMemberActiveAction, updateMemberAction, type MemberForm, type MemberResult } from "./memberActions";

type Device = { id: string; name: string; member_id: string | null; push_token: string | null; last_seen_at: string };
type Proj = { id: string; name: string };

const AVATAR = ["#4aa3a2", "#c98a52", "#7563f0", "#d6455d", "#1f9d6b", "#c97a10"];
const fmt = (iso: string) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** 設定頁「合夥人」：左邊名單＋邀請，右邊是選到的人的權限 */
export function PartnersPanel({ members, projects, devices }: { members: Member[]; projects: Proj[]; devices: Device[] }) {
  const L = useL();
  const [sel, setSel] = useState<string>(members[0]?.id ?? "new");
  const current = members.find((m) => m.id === sel) ?? null;
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);

  const status = (m: Member) =>
    !m.active ? { text: L("已停用", "Off"), tone: "off" } : !m.user_id ? { text: L("等他設密碼", "Invite pending"), tone: "warn" } : { text: L("使用中", "Active"), tone: "ok" };
  const summary = (m: Member) =>
    `${projects.filter((p) => m.project_ids.includes(p.id)).map((p) => p.name).join("、") || "—"}｜${m.can_edit ? L("可編輯", "Can edit") : L("只看", "View only")}`;

  return (
    <div className="partners">
      <section className="glass panel partners-list">
        <h3>{L("合夥人", "Partners")}</h3>
        <p className="muted small">{L("合夥人用自己的 Email 登入，只看得到你勾的畫面和專案。成本、辦公室、設定和私人模組的頁面永遠只有你看得到。", "Partners sign in with their own email and only see the screens and projects you pick. Costs, office, settings and private module pages stay yours.")}</p>
        <ul className="pt-people">
          {members.map((m, i) => {
            const st = status(m);
            return (
              <li key={m.id}>
                <button type="button" className={`pt-person ${sel === m.id ? "on" : ""}`} onClick={() => { setSel(m.id); setLink(null); }}>
                  <span className="pt-av" style={{ background: AVATAR[i % AVATAR.length] }}>{m.name.slice(0, 1)}</span>
                  <span className="pt-who"><b>{m.name}</b><span className="muted small">{summary(m)}</span></span>
                  <span className={`pt-pill ${st.tone}`}>{st.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={`btn ${sel === "new" ? "primary" : ""}`} onClick={() => { setSel("new"); setLink(null); }}>＋ {L("邀請新合夥人", "Invite a partner")}</button>
        {link && (
          <div className="pt-link">
            <p className="small">{L(`把這條連結傳給 ${link.name}（LINE、Slack 都可以），他點開設好密碼就能登入。7 天內有效、用一次就失效。`, `Send this link to ${link.name}. They set a password and can sign in. Valid 7 days, single use.`)}</p>
            <CopyLink url={link.url} />
          </div>
        )}
      </section>

      {sel === "new" || !current ? (
        <MemberEditor
          key="new"
          projects={projects}
          onDone={(r, name) => {
            if (!r.ok) return;
            if (r.link) setLink({ name, url: r.link });
            // 建好就切到這個人（名單重新整理後就會出現）
            if (r.id) setSel(r.id);
          }}
        />
      ) : (
        <MemberEditor
          key={current.id}
          member={current}
          color={AVATAR[members.indexOf(current) % AVATAR.length]}
          projects={projects}
          devices={devices.filter((d) => d.member_id === current.id)}
          onDone={(r, name) => r.ok && r.link && setLink({ name, url: r.link })}
          onDeleted={() => setSel(members.find((m) => m.id !== current.id)?.id ?? "new")}
        />
      )}
    </div>
  );
}

function CopyLink({ url }: { url: string }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  return (
    <div className="pt-copy">
      <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={L("邀請連結", "Invite link")} />
      <button
        type="button"
        className="btn small primary"
        onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? L("已複製", "Copied") : L("複製", "Copy")}
      </button>
    </div>
  );
}

function MemberEditor({
  member,
  color,
  projects,
  devices = [],
  onDone,
  onDeleted,
}: {
  member?: Member;
  color?: string;
  projects: Proj[];
  devices?: Device[];
  onDone: (r: MemberResult, name: string) => void;
  onDeleted?: () => void;
}) {
  const L = useL();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [v, setV] = useState<MemberForm>({
    name: member?.name ?? "",
    email: member?.email ?? "",
    projects: member?.project_ids ?? [],
    pages: member?.pages ?? MEMBER_TEMPLATES[0].pages,
    canEdit: member?.can_edit ?? MEMBER_TEMPLATES[0].canEdit,
    push: member?.push ?? true,
  });
  const toggle = (k: "projects" | "pages", id: string) => setV((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));
  const run = (fn: () => Promise<MemberResult>, after?: (r: MemberResult) => void) =>
    start(async () => {
      setSaved(false);
      const r = await fn().catch((e) => ({ ok: false, error: String(e instanceof Error ? e.message : e) }) as MemberResult);
      if (!r.ok) setError(r.error);
      else {
        setError(null);
        onDone(r, v.name);
        after?.(r);
        router.refresh();
      }
    });

  return (
    <section className="glass panel partners-edit">
      {member ? (
        <div className="pt-head">
          <span className="pt-av big" style={{ background: color }}>{member.name.slice(0, 1)}</span>
          <div>
            <input className="pt-name" value={v.name} maxLength={30} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label={L("名字", "Name")} />
            <p className="muted small">
              {member.email}・{member.last_login_at ? L(`最後登入 ${fmt(member.last_login_at)}`, `Last sign-in ${fmt(member.last_login_at)}`) : L("還沒登入過", "Never signed in")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <h3>{L("邀請新合夥人", "Invite a partner")}</h3>
          <div className="pt-row">
            <input placeholder={L("名字", "Name")} value={v.name} maxLength={30} onChange={(e) => setV({ ...v, name: e.target.value })} />
            <input placeholder="Email" type="email" value={v.email} maxLength={120} onChange={(e) => setV({ ...v, email: e.target.value })} />
          </div>
          <p className="pt-templates small">
            {L("套用範本：", "Template: ")}
            {MEMBER_TEMPLATES.map((t) => (
              <button key={t.key} type="button" className="chip-btn" onClick={() => setV({ ...v, pages: t.pages, canEdit: t.canEdit })}>{L(t.zh, t.en)}</button>
            ))}
          </p>
        </>
      )}

      <h4>{L("能看哪些專案", "Projects")}</h4>
      <div className="pt-checks">
        {projects.map((p) => (
          <label key={p.id} className="pt-check">
            <input type="checkbox" checked={v.projects.includes(p.id)} onChange={() => toggle("projects", p.id)} />
            {p.name}
          </label>
        ))}
      </div>

      <h4>{L("能進哪些畫面", "Screens")}</h4>
      <div className="pt-checks">
        {MEMBER_PAGES.map((p) => (
          <label key={p.key} className="pt-check">
            <input type="checkbox" checked={v.pages.includes(p.key)} onChange={() => toggle("pages", p.key)} />
            {L(p.zh, p.en)}
          </label>
        ))}
      </div>
      <p className="muted small">🔒 {L("成本、辦公室、設定，以及上面沒列出的頁面：永遠只有你看得到", "Costs, office, settings and any page not listed above are always yours only")}</p>

      <h4>{L("權限", "Permission")}</h4>
      <div className="seg" role="group" aria-label={L("權限", "Permission")}>
        <button type="button" className={!v.canEdit ? "active" : ""} aria-pressed={!v.canEdit} onClick={() => setV({ ...v, canEdit: false })}>{L("只看", "View only")}</button>
        <button type="button" className={v.canEdit ? "active" : ""} aria-pressed={v.canEdit} onClick={() => setV({ ...v, canEdit: true })}>{L("可編輯", "Can edit")}</button>
      </div>
      <p className="muted small">{L("可編輯＝在他的專案裡勾待辦、新增／改排程、寫日誌（日誌會記上他的名字）。階段、下一步、專案設定只有你能改。", "Can edit = tick to-dos, add/edit schedule items and write logs in their projects (logs show their name). Stages, next step and settings stay yours.")}</p>

      <h4>{L("推送", "Push")}</h4>
      <label className="pt-check">
        <input type="checkbox" checked={v.push} onChange={(e) => setV({ ...v, push: e.target.checked })} />
        {L("他的專案：今日排程、待辦到期前 7／1 天、排程前 30 分、產品掛掉／恢復（要開產品監控）", "Their projects: today's schedule, to-dos 7/1 days before they're due, 30 min before items, product down/up (needs monitor)")}
      </label>

      {member && (
        <>
          <h4>{L("手機 App", "Phone app")}</h4>
          {member.active && member.user_id ? (
            <AppPairing memberId={member.id} label={L(`產生 ${member.name} 的配對 QR code`, `Pairing QR for ${member.name}`)} />
          ) : (
            <p className="muted small">{L("他設好密碼後才能配對手機。", "They can pair a phone after setting a password.")}</p>
          )}
          {devices.length > 0 && (
            <ul className="status-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <span><b>{d.name}</b><span className="muted small">　{d.push_token ? L("🔔 推送已開", "🔔 Push on") : L("🔕 沒開推送", "🔕 Push off")}・{L("最後使用", "Last seen")} {fmt(d.last_seen_at)}</span></span>
                  <button type="button" className="btn ghost small" disabled={pending} onClick={() => start(async () => { await removeAppDevice(d.id); router.refresh(); })}>{L("解除配對", "Unpair")}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="error small" role="alert">{error}</p>}
      {saved && <p className="muted small" role="status">✓ {L("已儲存", "Saved")}</p>}
      <div className="pt-actions">
        {member ? (
          <>
            <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => updateMemberAction(member.id, v), () => setSaved(true))}>{pending ? L("儲存中…", "Saving…") : L("儲存", "Save")}</button>
            <button type="button" className="btn" disabled={pending || !member.active} onClick={() => run(() => resetInviteAction(member.id))} title={L("還沒設密碼的人重新給連結、忘記密碼的人重設", "New link for a pending invite or a forgotten password")}>
              {member.user_id ? L("產生重設密碼連結", "Password reset link") : L("重新產生邀請連結", "New invite link")}
            </button>
            {member.active ? (
              <button type="button" className="btn ghost danger-text" disabled={pending} onClick={() => window.confirm(L(`停用 ${member.name}？他會馬上不能登入，手機也會被登出。`, `Turn off ${member.name}? They are signed out everywhere.`)) && run(() => setMemberActiveAction(member.id, false))}>{L("停用這個帳號", "Turn off")}</button>
            ) : (
              <>
                <button type="button" className="btn" disabled={pending} onClick={() => run(() => setMemberActiveAction(member.id, true))}>{L("恢復", "Turn back on")}</button>
                <button type="button" className="btn ghost danger-text" disabled={pending} onClick={() => window.confirm(L(`永久刪除 ${member.name}？他的登入帳號也會刪掉，無法復原。`, `Delete ${member.name} for good? This can't be undone.`)) && run(() => deleteMemberAction(member.id), () => onDeleted?.())}>{L("刪除", "Delete")}</button>
              </>
            )}
          </>
        ) : (
          <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => inviteMemberAction(v))}>{pending ? L("建立中…", "Creating…") : L("建立並產生邀請連結", "Create invite link")}</button>
        )}
      </div>
    </section>
  );
}
