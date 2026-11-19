"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { DEFAULT_TIME, MAX_BODY, PLATFORMS, PLATFORM_LABEL, PLATFORM_NOTE, STATUS_LABEL, groupByDay, isUrl, postCounts, taipeiParts, type Platform, type Post, type PostStatus } from "@/lib/postLogic";
import { deletePostAction, draftPostAction, postponePostAction, savePostAction, setPostStatusAction, type PostResult } from "../postActions";

// 專案的「發文排程」分頁：新增／修改貼文、AI 寫草稿、依日期列出、複製文案、改狀態。
// 時間到伺服器會用 Telegram 把文案傳給主人（FB 社團不能用程式發文，只能自己貼）。

type Form = { id: string | null; platform: Platform; target: string; date: string; time: string; topic: string; body: string; image?: string | null; hasImage: boolean };
const WEEKDAY: [string, string][] = [["日", "Sun"], ["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"]];
type Filter = "open" | "done" | "all";

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

export function PostsTab({ projectId, posts, ready, images, canEdit, aiEnabled, today, now }: { projectId: string; posts: Post[]; ready: boolean; images: Record<string, string>; canEdit: boolean; aiEnabled: boolean; today: string; now: number }) {
  const L = useL();
  const router = useRouter();
  const blank = (): Form => ({ id: null, platform: "fb_group", target: "", date: today, time: DEFAULT_TIME, topic: "", body: "", hasImage: false });
  const [form, setForm] = useState<Form>(blank);
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drafting, startDraft] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => postCounts(posts), [posts]);
  const shown = useMemo(() => posts.filter((p) => (filter === "all" ? true : filter === "open" ? p.status === "draft" || p.status === "scheduled" : p.status === "posted" || p.status === "skipped")), [posts, filter]);
  const days = useMemo(() => groupByDay(shown), [shown]);

  const fail = (r: PostResult) => setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
  const run = (fn: () => Promise<PostResult>, okText?: string, after?: () => void) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false }) as PostResult);
      if (!r.ok) return fail(r);
      setMsg(okText ? { ok: true, text: okText } : null);
      after?.();
      router.refresh();
    });

  const save = (status: PostStatus) => {
    if (!form.body.trim() && !form.topic.trim()) return setMsg({ ok: false, text: L("主題或文案至少要填一個", "Add a topic or some copy") });
    run(
      () => savePostAction(projectId, form.id, { platform: form.platform, target: form.target, date: form.date, time: form.time, topic: form.topic, body: form.body, status, image: form.image }),
      status === "scheduled" ? L("已排定，時間到會用 Telegram 把文案傳給你。", "Scheduled. You'll get the copy on Telegram when it's time.") : L("已存成草稿（草稿不會提醒）。", "Saved as a draft (drafts don't send reminders)."),
      () => {
        setForm(blank());
        if (fileRef.current) fileRef.current.value = "";
      },
    );
  };

  const draft = () =>
    startDraft(async () => {
      const r = await draftPostAction(projectId, { platform: form.platform, target: form.target, topic: form.topic }).catch(() => ({ ok: false }) as PostResult);
      if (!r.ok || !r.draft) return fail(r);
      setForm((f) => ({ ...f, body: r.draft! }));
      setMsg({ ok: true, text: L("草稿寫好了，改成你的口氣再排定。", "Draft ready. Tweak it before scheduling.") });
    });

  const edit = (p: Post) => {
    const { date, time } = taipeiParts(p.due_at);
    setForm({ id: p.id, platform: p.platform, target: p.target, date, time, topic: p.topic, body: p.body, hasImage: !!p.image_path });
    setMsg(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const image = await shrinkImage(file);
      setForm((f) => ({ ...f, image, hasImage: true }));
    } catch {
      setMsg({ ok: false, text: L("這張圖片讀不了，換一張 JPG 或 PNG。", "Couldn't read that image. Try a JPG or PNG.") });
    }
  };

  const copy = async (p: Post) => {
    try {
      await navigator.clipboard.writeText(p.body);
      setCopied(p.id);
      setTimeout(() => setCopied((c) => (c === p.id ? null : c)), 1800);
    } catch {
      setMsg({ ok: false, text: L("複製不了，請展開文案自己選取。", "Couldn't copy. Expand the copy and select it yourself.") });
    }
  };

  const dayLabel = (date: string) => {
    const w = WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
    return `${+date.slice(5, 7)}/${+date.slice(8, 10)}（${L(...w)}）${date === today ? L("・今天", " · today") : ""}`;
  };

  if (!ready) {
    return <p className="notice glass">{L("發文排程需要先在 ideabox 的 Supabase 執行 migration-028-posts.sql。", "Run migration-028-posts.sql on the ideabox Supabase to use the post schedule.")}</p>;
  }

  return (
    <div className="post-tab">
      {canEdit && (
        <form
          ref={formRef}
          className="glass panel post-form"
          onSubmit={(e) => {
            e.preventDefault();
            save("scheduled");
          }}
        >
          <div className="post-form-row">
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as Platform })} aria-label={L("平台", "Platform")}>
              {PLATFORMS.map((k) => <option key={k} value={k}>{L(...PLATFORM_LABEL[k])}</option>)}
            </select>
            <input className="grow" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder={L("發在哪裡：社團名稱或連結", "Where: group name or link")} maxLength={300} aria-label={L("發在哪裡", "Where")} />
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label={L("預定日期", "Date")} required />
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} aria-label={L("預定時間", "Time")} required />
          </div>
          <div className="post-form-row">
            <input className="grow" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder={L("主題，例如：常見問題整理＋官方帳號", "Topic, e.g. FAQ roundup")} maxLength={300} aria-label={L("主題", "Topic")} />
            <button type="button" className="btn small" onClick={draft} disabled={drafting || !aiEnabled || !form.topic.trim()} title={aiEnabled ? undefined : L("還沒設定 ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY isn't set")}>
              {drafting ? L("AI 寫作中…", "Writing…") : L("✨ AI 寫草稿", "✨ Draft with AI")}
            </button>
          </div>
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={form.body.length > 300 ? 12 : 5} maxLength={MAX_BODY} placeholder={L("文案（可以自己寫，或先填主題按「AI 寫草稿」再改）", "Copy (write it yourself, or add a topic and draft with AI)")} aria-label={L("文案", "Copy")} />
          {!aiEnabled && <p className="muted small">{L("還沒設定 ANTHROPIC_API_KEY，所以 AI 寫草稿不能用；自己寫文案、排程與提醒都照常。", "ANTHROPIC_API_KEY isn't set, so AI drafts are off. Writing, scheduling and reminders still work.")}</p>}
          <div className="post-form-row">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
            <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>{form.hasImage ? L("換圖片", "Change image") : L("加圖片", "Add image")}</button>
            {form.hasImage && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {form.image ? <img className="post-thumb" src={form.image} alt="" /> : <span className="muted small">{L("已有圖片", "Has an image")}</span>}
                <button type="button" className="btn ghost small" onClick={() => { setForm({ ...form, image: null, hasImage: false }); if (fileRef.current) fileRef.current.value = ""; }}>{L("拿掉", "Remove")}</button>
              </>
            )}
            <span className="muted small grow post-note">{L(...PLATFORM_NOTE[form.platform])}</span>
            {form.id && <button type="button" className="btn ghost small" onClick={() => setForm(blank())}>{L("取消修改", "Cancel")}</button>}
            <button type="button" className="btn small" disabled={pending} onClick={() => save("draft")}>{L("存成草稿", "Save draft")}</button>
            <button type="submit" className="btn primary small" disabled={pending}>{pending ? L("處理中…", "Saving…") : form.id ? L("儲存並排定", "Save and schedule") : L("排定", "Schedule")}</button>
          </div>
        </form>
      )}

      {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}

      <div className="post-bar">
        <div className="seg" role="group" aria-label={L("顯示哪些", "Show")}>
          <button type="button" className={filter === "open" ? "active" : ""} aria-pressed={filter === "open"} onClick={() => setFilter("open")}>{L(`待發 ${counts.draft + counts.scheduled}`, `Upcoming ${counts.draft + counts.scheduled}`)}</button>
          <button type="button" className={filter === "done" ? "active" : ""} aria-pressed={filter === "done"} onClick={() => setFilter("done")}>{L(`已發／略過 ${counts.posted + counts.skipped}`, `Done ${counts.posted + counts.skipped}`)}</button>
          <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{L(`全部 ${posts.length}`, `All ${posts.length}`)}</button>
        </div>
        <span className="muted small">{L("時間到會用 Telegram 傳完整文案＋「已發／延後 1 天／略過」按鈕。也可以傳「短名 發文 11/21 20:00 中山社團 主題」新增。", "When it's time you get the full copy on Telegram with Posted / +1 day / Skip buttons.")}</span>
      </div>

      {days.length === 0 && <p className="muted post-empty">{posts.length ? L("這個分類沒有貼文。", "Nothing in this view.") : L("還沒有排任何貼文。在上面填好平台、時間和主題就能開始。", "No posts yet. Fill in the platform, time and topic above to start.")}</p>}

      {days.map((d) => (
        <section key={d.date} className="post-day">
          <h3 className={d.date < today ? "past" : ""}>{dayLabel(d.date)}</h3>
          {d.posts.map((p) => {
            const { time } = taipeiParts(p.due_at);
            const late = p.status === "scheduled" && Date.parse(p.due_at) < now;
            const isOpen = open.has(p.id);
            const long = p.body.length > 140 || p.body.split("\n").length > 3;
            return (
              <article key={p.id} className={`glass post-card ${p.status}`}>
                <header>
                  <b>{time}</b>
                  <span className="badge">{L(...PLATFORM_LABEL[p.platform])}</span>
                  {p.target && (isUrl(p.target) ? <a href={p.target.trim()} target="_blank" rel="noreferrer" className="post-target">{p.target}</a> : <span className="post-target">{p.target}</span>)}
                  <span className={`badge post-status ${p.status} ${late ? "late" : ""}`}>{L(...STATUS_LABEL[p.status])}{late ? L(p.notified_at ? "・已提醒" : "・時間到了", p.notified_at ? " · reminded" : " · due") : ""}</span>
                </header>
                {p.topic && <p className="post-topic">{p.topic}</p>}
                {p.body ? (
                  <p className={`post-body ${isOpen || !long ? "" : "clamp"}`}>{p.body}</p>
                ) : (
                  <p className="muted small">{L("還沒寫文案。按「編輯」再用 AI 寫草稿。", "No copy yet. Edit it and draft with AI.")}</p>
                )}
                {p.image_path && images[p.image_path] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="post-image" src={images[p.image_path]} alt={L("貼文圖片", "Post image")} loading="lazy" />
                )}
                <footer>
                  {long && <button type="button" className="btn ghost small" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}>{isOpen ? L("收起來", "Collapse") : L("看全文", "Show all")}</button>}
                  {p.body && <button type="button" className="btn ghost small" onClick={() => copy(p)}>{copied === p.id ? L("已複製 ✓", "Copied ✓") : L("複製文案", "Copy")}</button>}
                  {canEdit && (
                    <>
                      <button type="button" className="btn ghost small" onClick={() => edit(p)}>{L("編輯", "Edit")}</button>
                      {p.status === "draft" && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "scheduled"))}>{L("排定", "Schedule")}</button>}
                      {(p.status === "scheduled" || p.status === "draft") && (
                        <>
                          <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "posted"))}>{L("已發", "Posted")}</button>
                          <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => postponePostAction(p.id))}>{L("延後 1 天", "+1 day")}</button>
                          <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "skipped"))}>{L("略過", "Skip")}</button>
                        </>
                      )}
                      {(p.status === "posted" || p.status === "skipped") && <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(() => setPostStatusAction(p.id, "scheduled"))}>{L("改回已排定", "Back to scheduled")}</button>}
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
  );
}
