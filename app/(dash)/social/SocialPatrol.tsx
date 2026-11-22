"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { MIN_SAMPLE, POST_TYPES, findings, takeaways, typeLabel, type PatrolPost, type PatrolReport, type PatrolTemplate, type PostType } from "@/lib/patrolLogic";
import { firstSentence } from "@/lib/swipeLogic";
import type { SocialProject } from "./SocialView";
import { addSwipeAction, runPatrolAction, savePatrolKeywordsAction, type PostResult } from "./actions";

// Threads 海巡：看這週高流量貼文長什麼樣子。上面是共同點（程式算的），中間是各類型的模板（AI 整理的骨架），
// 下面是最紅的幾篇（含圖片）。模板可以直接拿去寫草稿。範圍分「這個專案的關鍵字」和「不限領域的熱門」。

export type PatrolScopeView = { done: PatrolReport | null; state: PatrolReport["status"] | null; error: string | null };
export type PatrolData = { ready: boolean; enabled: boolean; scopes: Record<string, PatrolScopeView>; images: Record<string, string>; keywords: string[] };

const WEEKDAY: [string, string][] = [["日", "Sun"], ["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"]];

/** 台北時間的「週四 22:10」 */
function whenText(at: string | null, L: (zh: string, en: string) => string): string {
  const t = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 8 * 3_600_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return L(`週${WEEKDAY[d.getUTCDay()][0]} ${hm}`, `${WEEKDAY[d.getUTCDay()][1]} ${hm}`);
}
function dayText(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function PatrolView({ projects, current, data, owner, aiEnabled, onUse }: { projects: SocialProject[]; current: SocialProject | null; data: PatrolData; owner: boolean; aiEnabled: boolean; onUse: (t: PatrolTemplate) => void }) {
  const L = useL();
  const router = useRouter();
  const [general, setGeneral] = useState(!current);
  const [type, setType] = useState<PostType | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isGeneral = general || !current;
  const key = isGeneral ? "general" : current!.id;
  const scope = data.scopes[key] ?? { done: null, state: null, error: null };
  const report = scope.done;
  const result = report?.result ?? null;
  const running = scope.state === "running";
  const canRun = isGeneral ? owner : !!current?.canEdit;
  // 存到靈感庫要有專案：目前選的，或第一個可編輯的
  const swipeProject = (current?.canEdit ? current : projects.find((p) => p.canEdit)) ?? null;

  // 換範圍時把類型篩選清掉
  useEffect(() => setType(null), [key]);
  // 抓取中：每 8 秒看一次好了沒
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [running, router]);

  const cards = useMemo(() => (result ? findings(result.stats) : []), [result]);
  const notes = useMemo(() => (result ? takeaways(result.stats) : []), [result]);
  const templates = useMemo(() => (result?.templates ?? []).filter((t) => !type || t.type === type), [result, type]);
  const posts = useMemo(() => (result?.posts ?? []).filter((p) => !type || p.type === type), [result, type]);

  const run = () =>
    start(async () => {
      const r = await runPatrolAction(isGeneral ? null : current!.id).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      setMsg({ ok: true, text: L("開始抓了，大約 1～3 分鐘，好了這頁會自己更新。", "Started. It takes 1–3 minutes and this page updates by itself.") });
      router.refresh();
    });
  const saveKeywords = () =>
    start(async () => {
      const r = await savePatrolKeywordsAction(editing ?? "").catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return setMsg({ ok: false, text: L("沒有存成功，再試一次。", "Couldn't save. Try again.") });
      setEditing(null);
      setMsg(null);
      router.refresh();
    });
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch {
      setMsg({ ok: false, text: L("複製不了，請自己選取文字。", "Couldn't copy. Select the text yourself.") });
    }
  };
  const keep = (p: PatrolPost) =>
    start(async () => {
      if (!swipeProject) return;
      const r = await addSwipeAction(swipeProject.id, { account: p.author ?? "", hook: firstSentence(p.text), url: p.url, views: p.views ?? "" }).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok && !/已經存過/.test(r.error ?? "")) return setMsg({ ok: false, text: r.error ?? L("沒有存成功。", "Couldn't save.") });
      setSaved((s) => new Set(s).add(p.url));
    });
  const toggle = (url: string) => setOpen((s) => { const n = new Set(s); if (n.has(url)) n.delete(url); else n.add(url); return n; });

  if (!data.ready) return <p className="notice glass">{L("Threads 海巡需要先在 ideabox 的 Supabase 執行 migration-037-patrol.sql。", "Run migration-037-patrol.sql on the ideabox Supabase to use the Threads patrol.")}</p>;

  return (
    <div className="soc-patrol">
      <div className="soc-patrol-bar">
        <div className="seg" role="group" aria-label={L("範圍", "Scope")}>
          <button type="button" className={isGeneral ? "" : "active"} aria-pressed={!isGeneral} disabled={!current} title={current ? undefined : L("先在上面選一個專案", "Pick a project above first")} onClick={() => setGeneral(false)}>{current ? L(`${current.name} 的關鍵字`, `${current.name} keywords`) : L("專案的關鍵字", "Project keywords")}</button>
          <button type="button" className={isGeneral ? "active" : ""} aria-pressed={isGeneral} onClick={() => setGeneral(true)}>{L("不限領域的熱門", "Trending anywhere")}</button>
        </div>
        <span className="grow" />
        {report && <span className="muted small">{L(`上次：${dayText(report.created_at)}・看了 ${report.post_count} 篇`, `Last run ${dayText(report.created_at)} · ${report.post_count} posts`)}</span>}
        {canRun && <button type="button" className="btn small" disabled={pending || running || !data.enabled} title={data.enabled ? undefined : L("還沒設定 APIFY_TOKEN", "APIFY_TOKEN isn't set")} onClick={run}>{running ? L("抓取中…", "Running…") : L("現在抓一次", "Run now")}</button>}
      </div>

      {(report?.keywords.length || isGeneral) && (
        <p className="soc-patrol-kw muted small">
          {L("用這些詞找的：", "Searched for: ")}
          {editing === null ? (
            <>
              {(isGeneral ? data.keywords : report?.keywords ?? []).join("、") || L("（還沒設定）", "(none yet)")}
              {isGeneral && owner && <button type="button" className="btn ghost small" onClick={() => setEditing(data.keywords.join("、"))}>{L("改", "Edit")}</button>}
              {!isGeneral && <span>{L("（跟話題雷達共用，到專案頁改）", " (shared with the topic radar; edit on the project page)")}</span>}
            </>
          ) : (
            <>
              <input value={editing} onChange={(e) => setEditing(e.target.value)} maxLength={200} aria-label={L("要抓的詞", "Keywords")} placeholder={L("用頓號分開，最多 5 個", "Separate with commas, up to 5")} />
              <button type="button" className="btn small" disabled={pending} onClick={saveKeywords}>{L("存", "Save")}</button>
              <button type="button" className="btn ghost small" onClick={() => setEditing(null)}>{L("取消", "Cancel")}</button>
            </>
          )}
        </p>
      )}

      {!data.enabled && <p className="muted small">{L("還沒設定 APIFY_TOKEN，所以不能抓新的貼文；已經整理好的照常能看。", "APIFY_TOKEN isn't set, so new runs are off. Existing reports still show.")}</p>}
      {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
      {scope.state === "failed" && <p className="error" role="status">{L(`上一次沒有抓成功（${scope.error ?? "原因不明"}）。${report ? "下面是更早那次的結果。" : ""}`, `The last run failed (${scope.error ?? "unknown"}).${report ? " Showing the earlier report." : ""}`)}</p>}

      {!result && !running && (
        <p className="muted post-empty">
          {isGeneral
            ? L("還沒有不限領域的熱門報告。每週日會自動抓一次，也可以按「現在抓一次」。", "No trending report yet. It runs every Sunday, or use Run now.")
            : L("這個專案還沒有海巡報告。先到專案頁的「話題雷達」設關鍵字，每週日會自動跑，也可以按「現在抓一次」。", "No report for this project yet. Add keywords under Topic radar on the project page; it runs every Sunday, or use Run now.")}
        </p>
      )}
      {!result && running && <p className="muted post-empty">{L("正在抓貼文、整理模板，大約 1～3 分鐘。", "Fetching posts and building templates. About 1–3 minutes.")}</p>}

      {result && (
        <>
          <section className="glass panel soc-patrol-find">
            <h3>{L("這週高流量貼文的共同點", "What this week's top posts have in common")} <span className="muted small">{L("互動前 20% 跟其他貼文比出來的，不是官方演算法", "Top 20% by engagement vs the rest. Not the official algorithm.")}</span></h3>
            {cards.length > 0 ? (
              <div className="soc-patrol-cards">
                {cards.map((c) => (
                  <div key={c.key}>
                    <b>{L(...c.value)}</b>
                    <span className="muted small">{L(...c.label)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">{L(`這次只抓到 ${result.stats.n} 篇，不到 ${MIN_SAMPLE} 篇，先不比較（樣本太少會看錯）。`, `Only ${result.stats.n} posts this time, under ${MIN_SAMPLE}, so no comparison yet.`)}</p>
            )}
            {(result.summary || notes.length > 0) && (
              <p className="soc-patrol-sum">{[result.summary, ...notes.map((n) => L(...n))].filter(Boolean).join(" ")}</p>
            )}
          </section>

          {result.types.length > 0 && (
            <div className="soc-patrol-types" role="group" aria-label={L("貼文類型", "Post type")}>
              <button type="button" className={`chip-btn ${type ? "" : "active"}`} aria-pressed={!type} onClick={() => setType(null)}>{L(`全部 ${result.types.length} 種`, `All ${result.types.length}`)}</button>
              {result.types.map((t) => (
                <button key={t.key} type="button" className={`chip-btn ${type === t.key ? "active" : ""}`} aria-pressed={type === t.key} title={POST_TYPES.find((x) => x.key === t.key)?.hint} onClick={() => setType(type === t.key ? null : t.key)}>
                  {L(...typeLabel(t.key))} ×{t.n}
                </button>
              ))}
            </div>
          )}

          <section>
            <h3>{L("模板", "Templates")} <span className="muted small">{L("每種類型一個，照這週最紅的幾篇整理出來的骨架。學寫法，不抄內容。", "One per type, built from this week's top posts. Borrow the shape, not the content.")}</span></h3>
            {templates.length === 0 && <p className="muted small">{result.templates.length ? L("這個類型這週沒有模板（至少要 2 篇才整理得出來）。", "No template for this type this week (needs at least 2 posts).") : aiEnabled ? L("這次沒有整理出模板（貼文太少，或 AI 暫時沒有回應）。再抓一次試試。", "No templates this time (too few posts, or the AI didn't respond). Try another run.") : L("還沒設定 ANTHROPIC_API_KEY，所以沒有類型與模板；共同點和貼文照常能看。", "ANTHROPIC_API_KEY isn't set, so there are no types or templates. The rest still works.")}</p>}
            <div className="soc-patrol-tpls">
              {templates.map((t) => {
                const c = result.types.find((x) => x.key === t.type);
                return (
                  <article key={t.type} className="glass panel soc-patrol-tpl">
                    <header>
                      <span className="soc-kind">{L(...typeLabel(t.type))}</span>
                      {c && <span className="muted small">{L(`${c.n} 篇`, `${c.n} posts`)}</span>}
                      {c?.x != null && <span className={`soc-x ${c.x >= 1.5 ? "hit" : ""}`}>{L(`中位數的 ${c.x} 倍`, `${c.x}x the median`)}</span>}
                    </header>
                    <pre>{t.skeleton}</pre>
                    {t.why && <p className="muted small">{L("為什麼有效：", "Why it works: ")}{t.why}</p>}
                    {t.refs.length > 0 && (
                      <p className="muted small">
                        {L("參考：", "From: ")}
                        {t.refs.map((r, i) => <a key={r.url} href={r.url} target="_blank" rel="noreferrer">{i ? "、" : ""}{r.author ? `@${r.author}` : L(`貼文 ${i + 1}`, `post ${i + 1}`)}</a>)}
                      </p>
                    )}
                    <footer>
                      {swipeProject && <button type="button" className="btn primary small" onClick={() => onUse(t)}>{L("用這個模板寫一篇", "Write with this")}</button>}
                      <button type="button" className="btn ghost small" onClick={() => copy(t.type, t.skeleton)}>{copied === t.type ? L("已複製 ✓", "Copied ✓") : L("複製骨架", "Copy skeleton")}</button>
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <h3>{L("這週最紅的貼文", "This week's top posts")} <span className="muted small">{L("照互動排（留言比讚重）；倍數＝是這批貼文中位數的幾倍", "By engagement (replies weigh more). The multiple is against this batch's median.")}</span></h3>
            {posts.length === 0 && <p className="muted small">{L("這個類型沒有貼文。", "No posts of this type.")}</p>}
            <ul className="soc-patrol-posts">
              {posts.map((p) => {
                const long = p.text.length > 110 || p.text.split("\n").length > 3;
                const isOpen = open.has(p.url);
                const imgs = p.images.filter((x) => data.images[x]);
                return (
                  <li key={p.url} className="glass">
                    <span className={`soc-x ${p.x === null ? "none" : p.x >= 3 ? "hit" : ""}`}>{p.x === null ? "—" : L(`${p.x} 倍`, `${p.x}x`)}</span>
                    <div className="soc-swipe-main">
                      <p className={`soc-patrol-text ${isOpen || !long ? "" : "clamp"}`}>{p.text}</p>
                      {imgs.length > 0 && (
                        <div className="soc-patrol-imgs">
                          {imgs.map((x, i) => (
                            <a key={x} href={data.images[x]} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={data.images[x]} alt={L(`貼文圖片 ${i + 1}`, `Post image ${i + 1}`)} loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                      <p className="muted small">
                        {p.type && <span className="soc-kind">{L(...typeLabel(p.type))}</span>}
                        {p.author ? ` @${p.author}・` : " "}
                        ♥ {p.likes.toLocaleString("en-US")}・💬 {p.replies.toLocaleString("en-US")}
                        {p.reposts ? `・🔁 ${p.reposts.toLocaleString("en-US")}` : ""}
                        {p.views ? L(`・${p.views.toLocaleString("en-US")} 次觀看`, ` · ${p.views.toLocaleString("en-US")} views`) : ""}
                        {L(`・${p.text.replace(/\s/g, "").length} 字`, ` · ${p.text.replace(/\s/g, "").length} chars`)}
                        {whenText(p.at, L) ? `・${whenText(p.at, L)}` : ""}
                      </p>
                    </div>
                    <div className="soc-patrol-acts">
                      <a className="btn ghost small" href={p.url} target="_blank" rel="noreferrer">{L("看原文", "Open")}</a>
                      {long && <button type="button" className="btn ghost small" onClick={() => toggle(p.url)}>{isOpen ? L("收起來", "Collapse") : L("看全文", "Show all")}</button>}
                      {swipeProject && <button type="button" className="btn ghost small" disabled={pending || saved.has(p.url)} onClick={() => keep(p)}>{saved.has(p.url) ? L("已存 ✓", "Saved ✓") : L("存到靈感庫", "Save to swipes")}</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
