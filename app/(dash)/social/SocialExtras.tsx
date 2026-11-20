"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { MIN_SAMPLE, auditOf, findings, type AuditRow } from "@/lib/auditLogic";
import { FORMAT_SHORT, KIND_LABEL, PLATFORM_LABEL, type Post } from "@/lib/postLogic";
import type { PlanSlot } from "@/lib/socialPlan";
import { HOOK_FORMULAS, SIGNAL, formulaCounts, formulaLabel, multipleOf, sortSwipes, viewsText, type Swipe } from "@/lib/swipeLogic";
import { addSwipeAction, auditAdviceAction, deleteSwipeAction, planWeekAction, savePlanAction, type PostResult } from "./actions";
import type { SocialProject } from "./SocialView";

const WEEKDAY: [string, string][] = [["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"], ["日", "Sun"]];
const md = (date: string) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
const weekday = (date: string) => WEEKDAY[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];

/** 「AI 排這週」：寫幾句這週發生的事 → AI 排出 4～5 則 → 勾選要的存成草稿（只有主題，文案之後再寫） */
export function PlanPanel({ project, week, aiEnabled, onClose }: { project: SocialProject; week: string; aiEnabled: boolean; onClose: () => void }) {
  const L = useL();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [slots, setSlots] = useState<PlanSlot[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(() => new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [planning, startPlan] = useTransition();
  const [saving, startSave] = useTransition();

  const plan = () =>
    startPlan(async () => {
      setMsg(null);
      const r = await planWeekAction(project.id, week, note).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok || !r.slots) return setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      setSlots(r.slots);
      setPicked(new Set(r.slots.map((_, i) => i)));
    });
  const save = () =>
    startSave(async () => {
      if (!slots) return;
      const r = await savePlanAction(project.id, slots.filter((_, i) => picked.has(i))).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      router.refresh();
      onClose();
    });
  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <section className="glass panel soc-plan" aria-label={L("AI 排這週", "Plan this week with AI")}>
      <header>
        <b>{L(`AI 排這週・${project.name}`, `Plan this week · ${project.name}`)}</b>
        <button type="button" className="btn ghost small" onClick={onClose}>{L("關閉", "Close")}</button>
      </header>
      <label>
        <span>{L("這週發生了什麼（選填，越具體排得越準）", "What happened this week (optional; specifics help)")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1500} placeholder={L("例如：開站第一天 40 人加好友、有人問會不會被同學看到、這週改了什麼…", "For example: 40 sign-ups on day one, a question people keep asking, what you changed this week…")} />
      </label>
      <p className="muted small">{L("AI 另外會自己讀：這個專案最近 14 天的工作日誌、話題雷達的痛點、高分點子、靈感庫裡有效的開頭、最近發過的主題（避免重複）。只排今天以後的日子。", "The AI also reads this project's last 14 days of logs, radar pain points, top ideas, swipe-file hooks and recent posts. It only plans from today onward.")}</p>
      {!aiEnabled && <p className="muted small">{L("還沒設定 ANTHROPIC_API_KEY，AI 排這週不能用。", "ANTHROPIC_API_KEY isn't set, so AI planning is unavailable.")}</p>}

      {slots && (
        <ul className="soc-plan-list">
          {slots.map((s, i) => (
            <li key={i} className={picked.has(i) ? "" : "off"}>
              <label>
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                <span className="soc-plan-when">{L(...weekday(s.date))} {md(s.date)} {s.time}</span>
                <span className={`soc-fmt ${s.format}`}>{L(...FORMAT_SHORT[s.format])}</span>
                <span className="soc-kind">{L(...KIND_LABEL[s.kind])}</span>
                <span className="muted small">{L(...PLATFORM_LABEL[s.platform])}</span>
              </label>
              <p>{s.topic}</p>
              <p className="muted small">{s.source ? L(`來源：${s.source}`, `From: ${s.source}`) : ""}{s.formula !== "other" ? `${s.source ? "・" : ""}${L("開頭公式：", "Hook: ")}${L(...formulaLabel(s.formula))}` : ""}</p>
            </li>
          ))}
        </ul>
      )}

      {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
      <footer>
        <span className="muted small grow">{slots ? L("只存主題，文案之後點進去再請 AI 寫。", "Only topics are saved. Open each one later to write the copy.") : ""}</span>
        <button type="button" className={`btn small ${slots ? "" : "primary"}`} disabled={planning || !aiEnabled} onClick={plan}>{planning ? L("AI 排程中…", "Planning…") : slots ? L("重新排", "Plan again") : L("✨ 開始排", "✨ Plan the week")}</button>
        {slots && <button type="button" className="btn primary small" disabled={saving || picked.size === 0} onClick={save}>{saving ? L("處理中…", "Saving…") : L(`把勾選的 ${picked.size} 則存成草稿`, `Save ${picked.size} as drafts`)}</button>}
      </footer>
    </section>
  );
}

type SwipeForm = { projectId: string; account: string; views: string; median: string; url: string; hook: string };

/** 靈感庫：同領域爆紅貼文的開頭。看「是那個帳號平常的幾倍」，不看觀看數 */
export function SwipeView({ projects, current, swipes, ready }: { projects: SocialProject[]; current: SocialProject | null; swipes: Swipe[]; ready: boolean }) {
  const L = useL();
  const router = useRouter();
  const editable = projects.filter((p) => p.canEdit);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const blank = (): SwipeForm => ({ projectId: (current?.canEdit ? current : editable[0])?.id ?? "", account: "", views: "", median: "", url: "", hook: "" });
  const [form, setForm] = useState<SwipeForm>(blank);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const mine = useMemo(() => sortSwipes(current ? swipes.filter((s) => s.project_id === current.id) : swipes), [swipes, current]);
  const top = useMemo(() => formulaCounts(mine), [mine]);
  const projectId = current?.canEdit ? current.id : form.projectId;

  const add = () =>
    start(async () => {
      const r = await addSwipeAction(projectId, { account: form.account, hook: form.hook, url: form.url, views: form.views, median: form.median }).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return setMsg(r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again."));
      setMsg(null);
      setForm({ ...blank(), projectId });
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      await deleteSwipeAction(id).catch(() => null);
      router.refresh();
    });

  if (!ready) return <p className="notice glass">{L("靈感庫需要先在 ideabox 的 Supabase 執行 migration-031-social-plan.sql。", "Run migration-031-social-plan.sql on the ideabox Supabase to use the swipe file.")}</p>;

  return (
    <div className="soc-swipes">
      {editable.length > 0 && projectId && (
        <form className="glass panel soc-swipe-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="soc-form-row">
            {!current?.canEdit && editable.length > 1 && (
              <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} aria-label={L("專案", "Project")}>
                {editable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder={L("@帳號", "@account")} maxLength={60} aria-label={L("帳號", "Account")} />
            <input value={form.views} onChange={(e) => setForm({ ...form, views: e.target.value })} placeholder={L("這則觀看，例如 41萬", "Views, e.g. 410000")} inputMode="decimal" aria-label={L("這則的觀看數", "Views on this post")} />
            <input value={form.median} onChange={(e) => setForm({ ...form, median: e.target.value })} placeholder={L("他平常的觀看，例如 1.1萬", "Their usual views, e.g. 11000")} inputMode="decimal" aria-label={L("這個帳號平常的觀看數", "The account's usual views")} />
            <input className="grow" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={L("貼文連結（選填）", "Post link (optional)")} maxLength={500} aria-label={L("貼文連結", "Post link")} />
          </div>
          <div className="soc-form-row">
            <input className="grow" value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder={L("開頭第一句，照原文貼（講的或畫面上的字）", "The first line, verbatim (spoken or on screen)")} maxLength={300} aria-label={L("開頭第一句", "First line")} required />
            <button type="submit" className="btn primary small" disabled={pending || form.hook.trim().length < 4}>{L("存起來", "Save")}</button>
          </div>
          <p className="muted small">{L(`「平常的觀看」＝看他最近十幾則，取中間那個數字。這則除以平常的，${SIGNAL} 倍以上才算他找到了什麼；觀看數很大但只有 1 倍，只是他平常的一天。找跟你差不多大的帳號，學開頭的形狀，不要抄內容。`, `“Usual views” is the middle value of their last dozen posts. ${SIGNAL}x or more is a signal; a big number at 1x is just their normal day. Copy the shape, never the content.`)}</p>
          {msg && <p className="error" role="status">{msg}</p>}
        </form>
      )}

      {top.length > 0 && (
        <p className="soc-swipe-top">
          <span className="muted small">{L(`最常出現在 ${SIGNAL} 倍以上的開頭：`, `Most common hooks at ${SIGNAL}x or more:`)}</span>
          {top.slice(0, 5).map((t) => <span key={t.key} className="soc-kind" title={HOOK_FORMULAS.find((f) => f.key === t.key)?.tip}>{L(...formulaLabel(t.key))} ×{t.n}</span>)}
          {mine.filter((s) => (multipleOf(s) ?? 0) >= SIGNAL).length < 8 && <span className="muted small">{L("（樣本還少，先當參考）", "(small sample so far)")}</span>}
        </p>
      )}

      {mine.length === 0 && <p className="muted post-empty">{L("還沒有存任何開頭。看到同領域爆紅的貼文，把第一句話和觀看數貼進來；話題雷達每週抓到的熱門貼文也會自動存進來。", "Nothing saved yet. Paste the first line and view counts of posts that took off in your niche. Weekly radar hits are saved here too.")}</p>}

      <ul className="soc-swipe-list">
        {mine.map((s) => {
          const x = multipleOf(s);
          const p = byId.get(s.project_id);
          return (
            <li key={s.id} className="glass">
              <span className={`soc-x ${x === null ? "none" : x >= SIGNAL ? "hit" : ""}`}>{x === null ? "—" : L(`${x} 倍`, `${x}x`)}</span>
              <div className="soc-swipe-main">
                <p>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.hook}</a> : s.hook}</p>
                <p className="muted small">
                  {!current && p ? <><i className="soc-dot" style={{ background: p.color }} /> {p.name}・</> : null}
                  <span className="soc-kind" title={HOOK_FORMULAS.find((f) => f.key === s.formula)?.tip}>{L(...formulaLabel(s.formula))}</span>
                  {s.account ? ` ${s.account}` : ""}
                  {s.views !== null ? L(`・${viewsText(s.views)}觀看`, ` · ${s.views.toLocaleString("en-US")} views`) : ""}
                  {s.median_views !== null ? L(`（平常 ${viewsText(s.median_views)}）`, ` (usually ${s.median_views.toLocaleString("en-US")})`) : ""}
                  {s.likes !== null ? L(`・${s.likes.toLocaleString("en-US")} 個讚`, ` · ${s.likes.toLocaleString("en-US")} likes`) : ""}
                  {s.source === "radar" ? L("・話題雷達自動存", " · from the radar") : ""}
                </p>
              </div>
              {p?.canEdit && <button type="button" className="btn ghost small" disabled={pending} onClick={() => remove(s.id)} aria-label={L("刪除這則", "Delete")}>{L("刪除", "Delete")}</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const n0 = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-US"));

/** 成效：已發貼文照「是你平常的幾倍」排，不照觀看數排。程式自己算出看得出來的事，另外可以請 AI 解讀 */
export function AuditView({ projects, current, posts, ready, aiEnabled, onEdit }: { projects: SocialProject[]; current: SocialProject | null; posts: Post[]; ready: boolean; aiEnabled: boolean; onEdit: (id: string) => void }) {
  const L = useL();
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const audit = useMemo(() => auditOf(posts), [posts]);
  const notes = useMemo(() => findings(audit), [audit]);
  const [advice, setAdvice] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, startAsk] = useTransition();
  const ranked = audit.rows.filter((r) => r.multiple !== null).length;
  const projectOf = (id: string) => byId.get(posts.find((p) => p.id === id)?.project_id ?? "");

  const ask = () =>
    startAsk(async () => {
      if (!current) return;
      const r = await auditAdviceAction(current.id).catch(() => ({ ok: false }) as PostResult);
      setAdvice(r.ok && r.draft ? { ok: true, text: r.draft } : { ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
    });

  if (!ready) return <p className="notice glass">{L("成效檢討需要先在 ideabox 的 Supabase 執行 migration-032-social-metrics.sql。", "Run migration-032-social-metrics.sql on the ideabox Supabase to use results.")}</p>;
  if (!audit.rows.length && !audit.missing.length) return <p className="muted post-empty">{L("還沒有已發的貼文。貼文標成「已發」之後，點開它就能填觀看、觸及、分享這些數字。", "No posted posts yet. Once a post is marked posted, open it to add its numbers.")}</p>;

  const row = (r: AuditRow) => {
    const p = projectOf(r.id);
    return (
      <li key={r.id} className="glass">
        <span className={`soc-x ${r.multiple === null ? "none" : r.multiple >= 2 ? "hit" : ""}`}>{r.multiple === null ? "—" : L(`${r.multiple} 倍`, `${r.multiple}x`)}</span>
        <div className="soc-swipe-main">
          <p>{r.title || L("（沒有標題）", "(untitled)")}</p>
          <p className="muted small">
            {!current && p ? <><i className="soc-dot" style={{ background: p.color }} /> {p.name}・</> : null}
            <span className={`soc-fmt ${r.format}`}>{L(...FORMAT_SHORT[r.format])}</span>{" "}
            {r.kind && <span className="soc-kind">{L(...KIND_LABEL[r.kind])}</span>}{" "}
            {md(r.date)}・{L(`觀看 ${n0(r.m.views)}`, `${n0(r.m.views)} views`)}
            {r.m.shares !== undefined ? L(`・分享 ${n0(r.m.shares)}`, ` · ${n0(r.m.shares)} shares`) : ""}
            {r.sharesPerK !== null ? L(`（每千觸及 ${r.sharesPerK}）`, ` (${r.sharesPerK} per 1k reach)`) : ""}
            {r.m.follows !== undefined ? L(`・追蹤 ${n0(r.m.follows)}`, ` · ${n0(r.m.follows)} follows`) : ""}
            {r.m.nonfollower !== undefined ? L(`・非追蹤者 ${r.m.nonfollower}%`, ` · ${r.m.nonfollower}% non-followers`) : ""}
          </p>
        </div>
        <button type="button" className="btn ghost small" onClick={() => onEdit(r.id)}>{L("改數字", "Edit")}</button>
      </li>
    );
  };

  return (
    <div className="soc-swipes">
      <div className="soc-kpis">
        <div className="glass"><span className="muted small">{L("有數字的貼文", "Posts with numbers")}</span><b>{L(`${audit.rows.length} 則`, String(audit.rows.length))}</b></div>
        <div className="glass"><span className="muted small">{L("平常的觀看（中位數）", "Usual views (median)")}</span><b>{audit.medianViews === null ? "—" : audit.medianViews.toLocaleString("en-US")}</b></div>
        <div className="glass"><span className="muted small">{L("每 1000 觸及的分享", "Shares per 1,000 reach")}</span><b>{audit.sharesPerK ?? "—"}</b></div>
        <div className="glass"><span className="muted small">{L("每 1000 觸及的追蹤", "Follows per 1,000 reach")}</span><b>{audit.followsPerK ?? "—"}</b></div>
      </div>

      <section className="glass panel soc-plan" aria-label={L("數字說了什麼", "What the numbers say")}>
        <header><b>{L("數字說了什麼", "What the numbers say")}</b></header>
        {ranked < MIN_SAMPLE ? (
          <p className="muted">{L(`有觀看數的貼文只有 ${ranked} 則，少於 ${MIN_SAMPLE} 則時只列數字、不下結論（樣本太少，下的結論多半是巧合）。`, `Only ${ranked} posts have view counts. Below ${MIN_SAMPLE}, this page lists numbers without drawing conclusions.`)}</p>
        ) : notes.length ? (
          <ol className="soc-findings">{notes.map((f) => <li key={f.key}>{L(...f.text)}</li>)}</ol>
        ) : (
          <p className="muted">{L("格式和類型之間還看不出明顯的差別。繼續填數字，差距夠大時這裡會寫出來。", "No clear gap between formats or types yet. Keep adding numbers.")}</p>
        )}
        {ranked >= MIN_SAMPLE && <p className="muted small">{L(`樣本 ${ranked} 則${ranked < 15 ? "，看得出方向但還不穩" : ""}。排名看「是你平常的幾倍」和分享率，不看觀看數的大小；發文時間幾乎不會是原因。`, `${ranked} posts${ranked < 15 ? ", enough for a direction but not stable yet" : ""}. Ranked by multiple of your usual views and share rate, not raw views.`)}</p>}
        {advice && <p className={advice.ok ? "soc-advice" : "error"} role="status">{advice.text}</p>}
        <footer>
          <span className="grow" />
          {current?.canEdit ? (
            <button type="button" className="btn small" disabled={asking || !aiEnabled || ranked < 3} title={aiEnabled ? undefined : L("還沒設定 ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY isn't set")} onClick={ask}>{asking ? L("AI 解讀中…", "Reviewing…") : L("✨ 請 AI 解讀：該多做什麼、該停什麼", "✨ Ask AI what to do more of and what to stop")}</button>
          ) : (
            <span className="muted small">{L("選一個專案才能請 AI 解讀", "Pick a project to ask the AI")}</span>
          )}
        </footer>
      </section>

      {audit.rows.length > 0 && <p className="muted small">{L("照「是你平常的幾倍」排，不照觀看數排", "Sorted by multiple of your usual views, not by raw views")}</p>}
      <ul className="soc-swipe-list">{audit.rows.map(row)}</ul>

      {audit.missing.length > 0 && (
        <section className="soc-missing">
          <p className="muted small">{L(`還有 ${audit.missing.length} 則已發的還沒填數字（發出去 3 天後再填比較準）`, `${audit.missing.length} posted post(s) still need numbers (wait about 3 days after posting)`)}</p>
          <ul className="soc-swipe-list">
            {audit.missing.slice(0, 12).map((m) => (
              <li key={m.id} className="glass">
                <span className="soc-x none">{md(m.date)}</span>
                <div className="soc-swipe-main"><p>{m.title || L("（沒有標題）", "(untitled)")}</p></div>
                <button type="button" className="btn small" onClick={() => onEdit(m.id)}>{L("去填", "Add numbers")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
