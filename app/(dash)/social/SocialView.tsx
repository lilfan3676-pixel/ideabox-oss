"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useL } from "@/app/LangProvider";
import { METRIC_KEYS, METRIC_LABEL, metricsOf, type MetricKey } from "@/lib/auditLogic";
import { checkCaption, VISIBLE_CHARS, type CaptionReport } from "@/lib/captionCheck";
import { isIsoDate } from "@/lib/dates";
import {
  DEFAULT_TIME, FORMAT_LABEL, FORMAT_SHORT, KINDS, KIND_LABEL, MAX_BODY, MAX_IMAGES, MAX_NOTE, PLATFORMS, PLATFORM_LABEL, PLATFORM_NOTE, STATUS_LABEL,
  addDays, formatOf, formatsFor, imagesOf, groupByDay, isKind, isUrl, postCounts, postTitle, taipeiParts, weekDays, weekStart,
  type Platform, type Post, type PostFormat, type PostKind, type PostStatus,
} from "@/lib/postLogic";
import { IconClose } from "../icons";
import { useView } from "../Nav";
import type { Swipe } from "@/lib/swipeLogic";
import type { ProfileResult } from "@/lib/engageLogic";
import { typeLabel, type PatrolTemplate } from "@/lib/patrolLogic";
import { EngageView, ProfileView } from "./SocialEngage";
import { PatrolView, type PatrolData } from "./SocialPatrol";
import { AuditView, PlanPanel, SwipeView } from "./SocialExtras";
import { deletePostAction, draftPostAction, postponePostAction, readMetricsAction, saveMetricsAction, savePostAction, setPostStatusAction, uploadPostImageAction, type PostResult } from "./actions";

// 社群助手：一週看板（預設）＋完整排程清單。點貼文或「新增貼文」從右邊滑出編輯面板，
// 裡面可以選格式（貼文／Reel／輪播／限動）、請 AI 寫草稿或腳本，下面即時顯示文案檢查。
// 時間到伺服器會用 Telegram 把文案傳給主人（平台不開放自動發文，只能自己貼）。

export type SocialProject = { id: string; slug: string; name: string; color: string; status: string; canEdit: boolean };
type Form = { id: string | null; projectId: string; platform: Platform; format: PostFormat; kind: PostKind | null; target: string; date: string; time: string; topic: string; body: string; note: string; /** 圖片照順序：path＝已經存好的，data＝剛選、還沒上傳的 */ imgs: FormImage[]; imgsChanged: boolean; status: PostStatus | null; /** 海巡的模板：AI 寫草稿時照這個骨架寫（不存檔） */ template: Pick<PatrolTemplate, "type" | "skeleton"> | null };
type FormImage = { path?: string; data?: string };
type Filter = "open" | "done" | "all";
const VIEWS = ["week", "posts", "audit", "swipes", "patrol", "engage", "profile"] as const;
type MetricForm = Record<MetricKey, string>;
const noMetrics = (): MetricForm => Object.fromEntries(METRIC_KEYS.map((k) => [k, ""])) as MetricForm;
const WEEKDAY: [string, string][] = [["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"], ["日", "Sun"]];
const md = (date: string) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;

/** 上傳前在瀏覽器把圖片縮到長邊 1400、轉成 JPEG，避免檔案太大傳不上去 */
async function shrinkImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export function SocialView({ projects, posts, images, aiEnabled, hasFormat, hasKind, hasMetrics, swipes, swipesReady, profiles, patrol, owner, today, now }: { projects: SocialProject[]; posts: Post[]; images: Record<string, string>; aiEnabled: boolean; hasFormat: boolean; hasKind: boolean; hasMetrics: boolean; swipes: Swipe[]; swipesReady: boolean; profiles: Record<string, ProfileResult>; patrol: PatrolData; owner: boolean; today: string; now: number }) {
  const L = useL();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const view = useView("week", VIEWS);
  const slug = sp.get("p") ?? "";
  const current = projects.find((p) => p.slug === slug) ?? null;
  const week = isIsoDate(sp.get("w")) ? weekStart(sp.get("w")!) : weekStart(today);
  const editable = projects.filter((p) => p.canEdit);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const [form, setForm] = useState<Form | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [metrics, setMetrics] = useState<MetricForm>(noMetrics);
  const [reading, startRead] = useTransition();
  const shotRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // 只改網址、不向伺服器重新要資料（專案與週次都是在瀏覽器裡篩）
  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    const s = p.toString();
    window.history.replaceState(null, "", s ? `${pathname}?${s}` : pathname);
  };

  const mine = useMemo(() => (current ? posts.filter((p) => p.project_id === current.id) : posts), [posts, current]);
  const reports = useMemo(() => new Map(mine.map((p) => [p.id, checkCaption(p.body, p.platform, formatOf(p))])), [mine]);
  const counts = useMemo(() => postCounts(mine), [mine]);
  const shown = useMemo(() => mine.filter((p) => (filter === "all" ? true : filter === "open" ? p.status === "draft" || p.status === "scheduled" : p.status === "posted" || p.status === "skipped")), [mine, filter]);
  const days = useMemo(() => groupByDay(shown), [shown]);
  const weekDates = useMemo(() => weekDays(week), [week]);
  const weekPosts = useMemo(() => {
    const map = new Map<string, Post[]>(weekDates.map((d) => [d, []]));
    for (const p of [...mine].sort((a, b) => a.due_at.localeCompare(b.due_at))) map.get(taipeiParts(p.due_at).date)?.push(p);
    return map;
  }, [mine, weekDates]);
  const weekAll = weekDates.flatMap((d) => weekPosts.get(d) ?? []).filter((p) => p.status !== "skipped");

  const fail = (r: PostResult) => setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
  const run = (fn: () => Promise<PostResult>, okText?: string, after?: () => void) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return fail(r);
      setMsg(okText ? { ok: true, text: okText } : null);
      after?.();
      router.refresh();
    });

  const blank = (date = today): Form | null => {
    const project = current?.canEdit ? current : editable[0];
    if (!project) return null;
    return { id: null, projectId: project.id, platform: "ig", format: "post", kind: null, target: "", date: date < today ? today : date, time: DEFAULT_TIME, topic: "", body: "", note: "", imgs: [], imgsChanged: false, status: null, template: null };
  };
  /** 海巡頁按「用這個模板寫一篇」：開新增面板，平台先選 Threads、帶著模板 */
  const writeWith = (t: PatrolTemplate) => {
    const f = blank();
    if (!f) return;
    setMsg(null);
    setForm({ ...f, platform: "threads", format: "post", template: { type: t.type, skeleton: t.skeleton } });
  };
  const edit = (p: Post) => {
    const { date, time } = taipeiParts(p.due_at);
    setMsg(null);
    const m = metricsOf(p);
    setMetrics(Object.fromEntries(METRIC_KEYS.map((k) => [k, m[k] === undefined ? "" : String(m[k])])) as MetricForm);
    setForm({ id: p.id, projectId: p.project_id, platform: p.platform, format: formatOf(p), kind: isKind(p.kind) ? p.kind : null, target: p.target, date, time, topic: p.topic, body: p.body, note: p.note ?? "", imgs: imagesOf(p).map((path) => ({ path })), imgsChanged: false, status: p.status, template: null });
  };
  const close = () => {
    setForm(null);
    if (fileRef.current) fileRef.current.value = "";
  };
  const canEditForm = form ? !!byId.get(form.projectId)?.canEdit : false;

  const save = (status: PostStatus) => {
    if (!form) return;
    if (!form.body.trim() && !form.topic.trim()) return setMsg({ ok: false, text: L("主題或文案至少要填一個", "Add a topic or some copy") });
    run(
      async () => {
        // 圖片有動才送清單；新選的一張一張先傳上去，換成簽章
        let images: string[] | undefined;
        if (form.imgsChanged) {
          images = [];
          for (const im of form.imgs) {
            if (im.path) images.push(im.path);
            else if (im.data) {
              const up = await uploadPostImageAction(form.projectId, im.data);
              if (!up.ok || !up.token) return { ok: false, error: up.error };
              images.push(up.token);
            }
          }
        }
        return savePostAction(form.projectId, form.id, { platform: form.platform, format: form.format, kind: form.kind, target: form.target, date: form.date, time: form.time, topic: form.topic, body: form.body, note: form.note, status, images });
      },
      status === "scheduled" ? L("已排定，時間到會用 Telegram 把文案傳給你。", "Scheduled. You'll get the copy on Telegram when it's time.") : status === "draft" ? L("已存成草稿（草稿不會提醒）。", "Saved as a draft (drafts don't send reminders).") : L("已儲存。", "Saved."),
      close,
    );
  };

  const draft = () =>
    startDraft(async () => {
      if (!form) return;
      const r = await draftPostAction(form.projectId, { platform: form.platform, format: form.format, kind: form.kind, target: form.target, topic: form.topic, template: form.format === "post" ? form.template : null }).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok || !r.draft) return fail(r);
      setForm((f) => (f ? { ...f, body: r.draft! } : f));
      setMsg({ ok: true, text: form.format === "post" ? L("草稿寫好了，改成你的口氣再排定。", "Draft ready. Tweak it before scheduling.") : L("腳本寫好了。開頭挑一個，其他改成你會講的話。", "Script ready. Pick one hook and make the rest sound like you.") });
    });

  const saveNumbers = () => {
    if (!form?.id) return;
    run(() => saveMetricsAction(form.id!, metrics), L("數字存好了，到「成效」看這則是你平常的幾倍。", "Saved. See how it compares under Results."));
  };
  const readShot = (file: File | undefined) =>
    startRead(async () => {
      if (!file || !form) return;
      try {
        const image = await shrinkImage(file);
        const r = await readMetricsAction(form.projectId, image).catch(() => ({ ok: false }) as PostResult);
        if (!r.ok || !r.metrics) return fail(r);
        const got = r.metrics;
        setMetrics((prev) => ({ ...prev, ...Object.fromEntries(METRIC_KEYS.filter((k) => got[k] !== undefined).map((k) => [k, String(got[k])])) }));
        setMsg({ ok: true, text: L(`讀到 ${Object.keys(got).length} 個數字，核對一下再按「存數字」。`, `Read ${Object.keys(got).length} numbers. Check them, then save.`) });
      } catch {
        setMsg({ ok: false, text: L("這張圖片讀不了，換一張 JPG 或 PNG。", "Couldn't read that image. Try a JPG or PNG.") });
      } finally {
        if (shotRef.current) shotRef.current.value = "";
      }
    });

  const pickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: FormImage[] = [];
    let bad = 0;
    // 照選的順序一張一張縮
    for (const file of Array.from(files)) {
      try {
        added.push({ data: await shrinkImage(file) });
      } catch {
        bad++;
      }
    }
    setForm((f) => {
      if (!f) return f;
      const room = MAX_IMAGES - f.imgs.length;
      if (added.length > room) setMsg({ ok: false, text: L(`一則最多 ${MAX_IMAGES} 張圖，多的沒有加進來。`, `Up to ${MAX_IMAGES} images per post. The extras weren't added.`) });
      return { ...f, imgs: [...f.imgs, ...added.slice(0, Math.max(0, room))], imgsChanged: true };
    });
    if (bad) setMsg({ ok: false, text: L("有圖片讀不了，換成 JPG 或 PNG。", "Some images couldn't be read. Try JPG or PNG.") });
    if (fileRef.current) fileRef.current.value = "";
  };
  const moveImage = (i: number, by: number) =>
    setForm((f) => {
      if (!f) return f;
      const j = i + by;
      if (j < 0 || j >= f.imgs.length) return f;
      const imgs = [...f.imgs];
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...f, imgs, imgsChanged: true };
    });
  const dropImage = (i: number) => setForm((f) => (f ? { ...f, imgs: f.imgs.filter((_, k) => k !== i), imgsChanged: true } : f));

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch {
      setMsg({ ok: false, text: L("複製不了，請自己選取文字。", "Couldn't copy. Select the text yourself.") });
    }
  };

  const dayLabel = (date: string) => {
    const w = WEEKDAY[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
    return `${md(date)}（${L(...w)}）${date === today ? L("・今天", " · today") : ""}`;
  };
  const formatPill = (p: Post) => <span className={`soc-fmt ${formatOf(p)}`}>{L(...FORMAT_SHORT[formatOf(p)])}</span>;
  const checkMark = (r: CaptionReport | undefined) => {
    if (!r || r.verdict === "empty") return <span className="soc-check empty">{L("還沒寫", "No copy")}</span>;
    if (r.verdict === "ok") return <span className="soc-check ok">{L("檢查通過", "Checks pass")}</span>;
    return <span className={`soc-check ${r.verdict}`}>{L(`${r.items.length} 個要看`, `${r.items.length} to review`)}</span>;
  };
  const kindPill = (p: Post) => (isKind(p.kind) ? <span className="soc-kind">{L(...KIND_LABEL[p.kind])}</span> : null);
  const dot = (p: Post) => (current ? null : <i className="soc-dot" style={{ background: byId.get(p.project_id)?.color }} title={byId.get(p.project_id)?.name} />);

  if (!projects.length) return <p className="muted soc-empty">{L("還沒有專案。先到「專案」新增一個，就能幫它排貼文。", "No projects yet. Add one under Projects to start planning posts.")}</p>;

  return (
    <div className="soc">
      <div className="soc-bar">
        <div className="soc-projects" role="group" aria-label={L("專案", "Project")}>
          <button type="button" className={`chip-btn ${current ? "" : "active"}`} aria-pressed={!current} onClick={() => setParam("p", null)}>{L("全部專案", "All projects")}</button>
          {projects.map((p) => (
            <button key={p.id} type="button" className={`chip-btn ${current?.id === p.id ? "active" : ""}`} aria-pressed={current?.id === p.id} onClick={() => setParam("p", p.slug)}>
              <i className="soc-dot" style={{ background: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
        {editable.length > 0 && <button type="button" className="btn primary small" onClick={() => { setMsg(null); setForm(blank()); }}>{L("新增貼文", "New post")}</button>}
      </div>

      {msg && !form && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}

      {view === "engage" ? (
        <EngageView projects={projects} current={current} aiEnabled={aiEnabled} today={today} />
      ) : view === "profile" ? (
        <ProfileView projects={projects} current={current} profiles={profiles} aiEnabled={aiEnabled} />
      ) : view === "audit" ? (
        <AuditView projects={projects} current={current} posts={mine} ready={hasMetrics} aiEnabled={aiEnabled} onEdit={(id) => { const p = posts.find((x) => x.id === id); if (p) edit(p); }} />
      ) : view === "patrol" ? (
        <PatrolView projects={projects} current={current} data={patrol} owner={owner} aiEnabled={aiEnabled} onUse={writeWith} />
      ) : view === "swipes" ? (
        <SwipeView projects={projects} current={current} swipes={swipes} ready={swipesReady} />
      ) : view === "week" ? (
        <>
          <div className="soc-weekbar">
            <button type="button" className="btn ghost small" onClick={() => setParam("w", addDays(week, -7))} aria-label={L("上一週", "Previous week")}>‹</button>
            <b>{md(weekDates[0])} – {md(weekDates[6])}</b>
            <button type="button" className="btn ghost small" onClick={() => setParam("w", addDays(week, 7))} aria-label={L("下一週", "Next week")}>›</button>
            {week !== weekStart(today) && <button type="button" className="btn ghost small" onClick={() => setParam("w", null)}>{L("回到本週", "This week")}</button>}
            {editable.length > 0 && !planning && (
              <button type="button" className="btn small" disabled={!current?.canEdit} title={current?.canEdit ? undefined : L("先在上面選一個專案", "Pick a project above first")} onClick={() => setPlanning(true)}>{L("✨ AI 排這週", "✨ Plan with AI")}</button>
            )}
            {editable.length > 0 && !current && <span className="muted small">{L("選一個專案才能請 AI 排", "Pick a project to plan with AI")}</span>}
            <span className="muted small soc-weeksum">
              {weekAll.length
                ? L(`這週 ${weekAll.length} 則`, `${weekAll.length} this week`) + (["reel", "carousel", "story", "post"] as PostFormat[]).map((f) => [f, weekAll.filter((p) => formatOf(p) === f).length] as const).filter(([, n]) => n).map(([f, n]) => `・${L(...FORMAT_SHORT[f])} ${n}`).join("")
                : L("這週還沒排貼文", "Nothing planned this week")}
            </span>
          </div>
          {planning && current?.canEdit && <PlanPanel key={`${current.id}:${week}`} project={current} week={week} aiEnabled={aiEnabled} onClose={() => setPlanning(false)} />}
          <div className="soc-week">
            {weekDates.map((date, i) => {
              const list = weekPosts.get(date) ?? [];
              return (
                <section key={date} className={`glass soc-day ${date === today ? "today" : ""} ${date < today ? "past" : ""} ${list.length ? "" : "none"}`}>
                  <header>
                    <b>{L(...WEEKDAY[i])}</b>
                    <span className="muted small">{md(date)}</span>
                    {editable.length > 0 && date >= today && <button type="button" className="soc-add" onClick={() => { setMsg(null); setForm(blank(date)); }} aria-label={L(`在 ${md(date)} 新增貼文`, `Add a post on ${md(date)}`)}>＋</button>}
                  </header>
                  {list.length === 0 && <p className="muted small soc-none">—</p>}
                  {list.map((p) => (
                    <button key={p.id} type="button" className={`soc-card ${p.status}`} onClick={() => edit(p)}>
                      <span className="soc-card-top">{dot(p)}<b>{taipeiParts(p.due_at).time}</b>{formatPill(p)}{kindPill(p)}</span>
                      <span className="soc-card-title">{postTitle(p) || p.target || L("（沒有標題）", "(untitled)")}</span>
                      <span className="soc-card-meta">{L(...PLATFORM_LABEL[p.platform])}・{L(...STATUS_LABEL[p.status])}</span>
                      {(p.status === "draft" || p.status === "scheduled") && checkMark(reports.get(p.id))}
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
          <p className="muted small">{L("點貼文可以改內容、看文案檢查；時間到會用 Telegram 把完整文案傳給你，自己貼上去（平台不開放自動發文）。", "Click a post to edit it and see the copy checks. When it's time you get the full copy on Telegram to post yourself.")}</p>
        </>
      ) : (
        <div className="post-tab">
          <div className="post-bar">
            <div className="seg" role="group" aria-label={L("顯示哪些", "Show")}>
              <button type="button" className={filter === "open" ? "active" : ""} aria-pressed={filter === "open"} onClick={() => setFilter("open")}>{L(`待發 ${counts.draft + counts.scheduled}`, `Upcoming ${counts.draft + counts.scheduled}`)}</button>
              <button type="button" className={filter === "done" ? "active" : ""} aria-pressed={filter === "done"} onClick={() => setFilter("done")}>{L(`已發／略過 ${counts.posted + counts.skipped}`, `Done ${counts.posted + counts.skipped}`)}</button>
              <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{L(`全部 ${mine.length}`, `All ${mine.length}`)}</button>
            </div>
            <span className="muted small">{L("也可以傳 Telegram「短名 發文 11/21 20:00 IG Reel 主題」新增。", "You can also add one from Telegram: “slug 發文 11/21 20:00 IG Reel topic”.")}</span>
          </div>

          {days.length === 0 && <p className="muted post-empty">{mine.length ? L("這個分類沒有貼文。", "Nothing in this view.") : L("還沒有排任何貼文。按右上角「新增貼文」開始。", "No posts yet. Use New post to start.")}</p>}

          {days.map((d) => (
            <section key={d.date} className="post-day">
              <h3 className={d.date < today ? "past" : ""}>{dayLabel(d.date)}</h3>
              {d.posts.map((p) => {
                const late = p.status === "scheduled" && Date.parse(p.due_at) < now;
                const isOpen = open.has(p.id);
                const long = p.body.length > 140 || p.body.split("\n").length > 3;
                const can = !!byId.get(p.project_id)?.canEdit;
                const live = p.status === "draft" || p.status === "scheduled";
                return (
                  <article key={p.id} className={`glass post-card ${p.status}`}>
                    <header>
                      {dot(p)}
                      <b>{taipeiParts(p.due_at).time}</b>
                      <span className="badge">{L(...PLATFORM_LABEL[p.platform])}</span>
                      {formatOf(p) !== "post" && formatPill(p)}
                      {kindPill(p)}
                      {p.target && (isUrl(p.target) ? <a href={p.target.trim()} target="_blank" rel="noreferrer" className="post-target">{p.target}</a> : <span className="post-target">{p.target}</span>)}
                      <span className={`badge post-status ${p.status} ${late ? "late" : ""}`}>{L(...STATUS_LABEL[p.status])}{late ? L(p.notified_at ? "・已提醒" : "・時間到了", p.notified_at ? " · reminded" : " · due") : ""}</span>
                    </header>
                    {p.topic && <p className="post-topic">{p.topic}</p>}
                    {p.body ? <p className={`post-body ${isOpen || !long ? "" : "clamp"}`}>{p.body}</p> : <p className="muted small">{L("還沒寫文案。按「編輯」再用 AI 寫草稿。", "No copy yet. Edit it and draft with AI.")}</p>}
                    {imagesOf(p).some((x) => images[x]) && (
                      <div className="post-images">
                        {imagesOf(p).filter((x) => images[x]).map((x, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={x} className="post-image" src={images[x]} alt={L(`貼文圖片 ${i + 1}`, `Post image ${i + 1}`)} loading="lazy" />
                        ))}
                      </div>
                    )}
                    <footer>
                      {live && checkMark(reports.get(p.id))}
                      {long && <button type="button" className="btn ghost small" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>{isOpen ? L("收起來", "Collapse") : L("看全文", "Show all")}</button>}
                      {p.body && <button type="button" className="btn ghost small" onClick={() => copy(p.id, p.body)}>{copied === p.id ? L("已複製 ✓", "Copied ✓") : L("複製文案", "Copy")}</button>}
                      {can && (
                        <>
                          <button type="button" className="btn ghost small" onClick={() => edit(p)}>{L("編輯", "Edit")}</button>
                          {p.status === "draft" && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "scheduled"))}>{L("排定", "Schedule")}</button>}
                          {live && (
                            <>
                              <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "posted"))}>{L("已發", "Posted")}</button>
                              <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => postponePostAction(p.id))}>{L("延後 1 天", "+1 day")}</button>
                              <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "skipped"))}>{L("略過", "Skip")}</button>
                            </>
                          )}
                          {!live && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "scheduled"))}>{L("改回已排定", "Back to scheduled")}</button>}
                          <button type="button" className="btn ghost small danger" disabled={pending} onClick={() => { if (window.confirm(L("刪除這則貼文？", "Delete this post?"))) run(() => deletePostAction(p.id)); }}>{L("刪除", "Delete")}</button>
                        </>
                      )}
                    </footer>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {form && (
        <Drawer title={form.id ? L("修改貼文", "Edit post") : L("新增貼文", "New post")} onClose={close}>
          <form
            className="soc-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canEditForm) save("scheduled");
            }}
          >
            <fieldset disabled={!canEditForm}>
              {!form.id && editable.length > 1 && (
                <label>
                  <span>{L("專案", "Project")}</span>
                  <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                    {editable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {(form.id || editable.length <= 1) && <p className="soc-form-project"><i className="soc-dot" style={{ background: byId.get(form.projectId)?.color }} />{byId.get(form.projectId)?.name}</p>}
              <div className="soc-form-row">
                <label>
                  <span>{L("平台", "Platform")}</span>
                  <select value={form.platform} onChange={(e) => { const platform = e.target.value as Platform; setForm({ ...form, platform, format: formatsFor(platform).includes(form.format) ? form.format : "post" }); }}>
                    {PLATFORMS.map((k) => <option key={k} value={k}>{L(...PLATFORM_LABEL[k])}</option>)}
                  </select>
                </label>
                <label>
                  <span>{L("日期", "Date")}</span>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                </label>
                <label>
                  <span>{L("時間", "Time")}</span>
                  <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required />
                </label>
              </div>
              {formatsFor(form.platform).length > 1 && (
                <div className="soc-form-field">
                  <span>{L("格式", "Format")}</span>
                  <div className="seg small-seg" role="group" aria-label={L("格式", "Format")}>
                    {formatsFor(form.platform).map((f) => (
                      <button key={f} type="button" className={form.format === f ? "active" : ""} aria-pressed={form.format === f} disabled={f !== "post" && !hasFormat} onClick={() => setForm({ ...form, format: f })}>{L(...FORMAT_LABEL[f])}</button>
                    ))}
                  </div>
                  {!hasFormat && <p className="muted small">{L("Reel／輪播／限動要先執行 migration-030-social.sql。", "Run migration-030-social.sql to use Reel, carousel and story.")}</p>}
                </div>
              )}
              {hasKind && (
                <label>
                  <span>{L("類型（選填，AI 會照這個方向寫）", "Type (optional; steers the AI draft)")}</span>
                  <select value={form.kind ?? ""} onChange={(e) => setForm({ ...form, kind: isKind(e.target.value) ? e.target.value : null })}>
                    <option value="">{L("不指定", "None")}</option>
                    {KINDS.map((k) => <option key={k} value={k}>{L(...KIND_LABEL[k])}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span>{L("發在哪裡", "Where")}</span>
                <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder={L("帳號、社團名稱或連結", "Account, group name or link")} maxLength={300} />
              </label>
              <label>
                <span>{L("主題", "Topic")}</span>
                <input value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder={L("這則要講什麼，越具體越好", "What this one is about. Be specific.")} maxLength={300} />
              </label>
              {form.template && form.format === "post" && (
                <div className="soc-tpl-pick">
                  <span className="soc-kind">{L(`模板：${typeLabel(form.template.type)[0]}`, `Template: ${typeLabel(form.template.type)[1]}`)}</span>
                  <span className="muted small">{L("AI 會照這個骨架寫", "The AI draft follows this shape")}</span>
                  <button type="button" className="btn ghost small" onClick={() => setForm({ ...form, template: null })} aria-label={L("不用模板", "Remove the template")}>×</button>
                  <pre>{form.template.skeleton}</pre>
                </div>
              )}
              <div className="soc-form-row end">
                <button type="button" className="btn small" onClick={draft} disabled={drafting || !aiEnabled || !form.topic.trim()} title={aiEnabled ? undefined : L("還沒設定 ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY isn't set")}>
                  {drafting ? L("AI 寫作中…", "Writing…") : form.format === "post" ? (form.template ? L("✨ 照模板寫草稿", "✨ Draft from template") : L("✨ AI 寫草稿", "✨ Draft with AI")) : L(`✨ AI 寫${FORMAT_SHORT[form.format][0]}腳本`, `✨ Write the ${FORMAT_SHORT[form.format][1]} script`)}
                </button>
                {form.body && <button type="button" className="btn ghost small" onClick={() => copy("form", form.body)}>{copied === "form" ? L("已複製 ✓", "Copied ✓") : L("複製", "Copy")}</button>}
              </div>
              {!aiEnabled && <p className="muted small">{L("還沒設定 ANTHROPIC_API_KEY，所以 AI 寫草稿不能用；自己寫文案、排程與提醒都照常。", "ANTHROPIC_API_KEY isn't set, so AI drafts are off. Writing, scheduling and reminders still work.")}</p>}
              <label>
                <span>{form.format === "post" ? L("文案", "Copy") : L("腳本", "Script")}</span>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={form.body.length > 300 ? 16 : 7} maxLength={MAX_BODY} placeholder={form.format === "post" ? L("自己寫，或先填主題按「AI 寫草稿」再改", "Write it yourself, or add a topic and draft with AI") : L("先填主題按上面的按鈕，AI 會照這個格式寫出腳本", "Add a topic and use the button above to get a script in this format")} />
              </label>
              <CheckPanel report={checkCaption(form.body, form.platform, form.format)} platform={form.platform} format={form.format} />
              <div className="post-imgs">
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => pickImages(e.target.files)} />
                {form.imgs.map((im, i) => {
                  const src = im.data ?? (im.path ? images[im.path] : undefined);
                  return (
                    <div className="post-img" key={im.path ?? `new-${i}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {src ? <img src={src} alt={L(`第 ${i + 1} 張`, `Image ${i + 1}`)} /> : <span className="post-img-blank">{i + 1}</span>}
                      <span className="post-img-n">{i + 1}</span>
                      <div className="post-img-acts">
                        <button type="button" onClick={() => moveImage(i, -1)} disabled={i === 0} aria-label={L(`第 ${i + 1} 張往前移`, `Move image ${i + 1} earlier`)}>‹</button>
                        <button type="button" onClick={() => moveImage(i, 1)} disabled={i === form.imgs.length - 1} aria-label={L(`第 ${i + 1} 張往後移`, `Move image ${i + 1} later`)}>›</button>
                        <button type="button" onClick={() => dropImage(i)} aria-label={L(`拿掉第 ${i + 1} 張`, `Remove image ${i + 1}`)}>×</button>
                      </div>
                    </div>
                  );
                })}
                {form.imgs.length < MAX_IMAGES && (
                  <button type="button" className="post-img-add" onClick={() => fileRef.current?.click()}>
                    <span aria-hidden="true">＋</span>
                    {form.imgs.length ? L("再加圖片", "Add more") : L("加圖片", "Add images")}
                  </button>
                )}
              </div>
              {form.imgs.length > 1 && <p className="muted small">{L(`${form.imgs.length} 張圖，提醒時會照這個順序一起傳。用 ‹ › 調順序。`, `${form.imgs.length} images, sent in this order with the reminder. Use ‹ › to reorder.`)}</p>}
              <label>
                <span>{L("備註（只給自己看，提醒時一起傳）", "Note (for you only, sent with the reminder)")}</span>
                <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={form.note.length > 80 ? 5 : 2} maxLength={MAX_NOTE} placeholder={L("例如：配圖放在哪裡、發完要做什麼", "e.g. where the images are, what to do after posting")} />
              </label>
              <p className="muted small">{L(...PLATFORM_NOTE[form.platform])}</p>
            </fieldset>
            {form.id && form.status === "posted" && hasMetrics && (
              <section className="soc-metrics" aria-label={L("成效", "Results")}>
                <header>
                  <b>{L("成效", "Results")}</b>
                  <span className="muted small">{L("到平台的洞察報告看，沒有的留空", "From the platform's insights. Leave blanks empty.")}</span>
                </header>
                <fieldset disabled={!canEditForm}>
                  <div className="soc-metric-grid">
                    {METRIC_KEYS.map((k) => (
                      <label key={k}>
                        <span>{L(...METRIC_LABEL[k])}</span>
                        <input value={metrics[k]} onChange={(e) => setMetrics({ ...metrics, [k]: e.target.value })} inputMode="decimal" maxLength={12} />
                      </label>
                    ))}
                  </div>
                  <div className="soc-form-row">
                    <input ref={shotRef} type="file" accept="image/*" hidden onChange={(e) => readShot(e.target.files?.[0])} />
                    <button type="button" className="btn ghost small" disabled={reading || !aiEnabled} title={aiEnabled ? undefined : L("還沒設定 ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY isn't set")} onClick={() => shotRef.current?.click()}>{reading ? L("AI 讀取中…", "Reading…") : L("貼洞察報告截圖，AI 幫你讀", "Read numbers from a screenshot")}</button>
                    <span className="grow" />
                    <button type="button" className="btn small" disabled={pending} onClick={saveNumbers}>{L("存數字", "Save numbers")}</button>
                  </div>
                </fieldset>
              </section>
            )}
            {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
            {canEditForm ? (
              <div className="soc-form-actions">
                {form.id && (
                  <button type="button" className="btn ghost small danger" disabled={pending} onClick={() => { if (window.confirm(L("刪除這則貼文？", "Delete this post?"))) run(() => deletePostAction(form.id!), undefined, close); }}>{L("刪除", "Delete")}</button>
                )}
                <span className="grow" />
                {form.id && (form.status === "scheduled" || form.status === "draft") && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(form.id!, "posted"), undefined, close)}>{L("標成已發", "Mark posted")}</button>}
                <button type="button" className="btn small" disabled={pending} onClick={() => save("draft")}>{L("存成草稿", "Save draft")}</button>
                <button type="submit" className="btn primary small" disabled={pending}>{pending ? L("處理中…", "Saving…") : form.id ? L("儲存並排定", "Save and schedule") : L("排定", "Schedule")}</button>
              </div>
            ) : (
              <p className="muted small">{L("你可以看這則貼文，但沒有修改的權限。", "You can view this post but can't edit it.")}</p>
            )}
          </form>
        </Drawer>
      )}
    </div>
  );
}

/** 文案檢查的結果：「…更多」前面會露出什麼、幾個字、幾個 hashtag，以及要改的地方 */
function CheckPanel({ report, platform, format }: { report: CaptionReport; platform: Platform; format: PostFormat }) {
  const L = useL();
  if (report.verdict === "empty") return null;
  return (
    <section className={`soc-checks ${report.verdict}`} aria-label={L("文案檢查", "Copy checks")}>
      <header>
        <b>{L("文案檢查", "Copy checks")}</b>
        <span className={`soc-check ${report.verdict}`}>{report.verdict === "ok" ? L("通過", "Pass") : report.verdict === "fail" ? L("有要改的", "Needs fixing") : L("有提醒", "Worth a look")}</span>
        {report.hasCaption && report.length > 0 && <span className="muted small">{L(`${format === "post" ? "" : "貼文說明 "}${report.length} 字・${report.hashtags.length} 個 hashtag`, `${report.length} chars · ${report.hashtags.length} hashtags`)}</span>}
      </header>
      {platform === "ig" && report.visible && (
        <div className="soc-visible">
          <span className="muted small">{L(`「…更多」前面會看到的（約 ${VISIBLE_CHARS} 個字）`, `Shown before “…more” (about ${VISIBLE_CHARS} characters)`)}</span>
          <p>{report.visible}{report.cut ? "…" : ""}</p>
        </div>
      )}
      {report.items.length > 0 && (
        <ul>
          {report.items.map((it) => (
            <li key={it.key} className={it.level}>{L(...it.text)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 從右邊滑出的面板（手機從下面）。掛在 body 上，避免頁面進場動畫讓 fixed 失效 */
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const L = useL();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="drawer glass" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <span className="drawer-grip" aria-hidden />
          <b>{title}</b>
          <button type="button" className="circle-btn drawer-close" onClick={onClose} aria-label={L("關閉", "Close")}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
