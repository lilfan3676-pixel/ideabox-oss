"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import {
  BUCKETS, BUCKET_HINT, BUCKET_LABEL, DM_HINT, DM_KINDS, DM_LABEL, PROFILE_FIELDS, PROFILE_FIELD_LABEL, PROFILE_TOTAL,
  bucketCounts, commentTypeLabel, rubricLabel,
  type CommentOut, type DmKind, type DmOut, type ProfileField, type ProfileResult, type ReplyOut,
} from "@/lib/engageLogic";
import { DEFAULT_TIME, addDays } from "@/lib/postLogic";
import { checkProfileAction, draftCommentsAction, draftDmAction, draftRepliesAction, savePostAction, type EngageResult } from "./actions";
import type { SocialProject } from "./SocialView";

type Msg = { ok: boolean; text: string } | null;
const MODES = ["reply", "dm", "comment"] as const;
type Mode = (typeof MODES)[number];

/** 選專案：上方已經選了可編輯的專案就用它，否則在這裡選 */
function useProject(projects: SocialProject[], current: SocialProject | null) {
  const editable = projects.filter((p) => p.canEdit);
  const [picked, setPicked] = useState(editable[0]?.id ?? "");
  const id = current?.canEdit ? current.id : picked;
  return { editable, id, setPicked, locked: !!current?.canEdit };
}

function ProjectPick({ editable, id, setPicked, locked }: ReturnType<typeof useProject>) {
  const L = useL();
  if (locked || editable.length <= 1) return null;
  return (
    <select value={id} onChange={(e) => setPicked(e.target.value)} aria-label={L("專案", "Project")}>
      {editable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function CopyBtn({ text }: { text: string }) {
  const L = useL();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* 複製不了就讓使用者自己選取 */
        }
      }}
    >
      {done ? L("已複製 ✓", "Copied ✓") : L("複製", "Copy")}
    </button>
  );
}

/** 互動：回覆留言、寫私訊、去別人貼文留言。全部只寫草稿，自己複製去貼；不存檔 */
export function EngageView({ projects, current, aiEnabled, today }: { projects: SocialProject[]; current: SocialProject | null; aiEnabled: boolean; today: string }) {
  const L = useL();
  const router = useRouter();
  const pick = useProject(projects, current);
  const [mode, setMode] = useState<Mode>("reply");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, start] = useTransition();

  const [comments, setComments] = useState("");
  const [context, setContext] = useState("");
  const [replies, setReplies] = useState<ReplyOut[] | null>(null);
  const [savedReel, setSavedReel] = useState<Set<number>>(() => new Set());

  const [dmKind, setDmKind] = useState<DmKind>("deliver");
  const [dmForm, setDmForm] = useState({ who: "", trigger: "", give: "", want: "" });
  const [dm, setDm] = useState<DmOut | null>(null);

  const [cForm, setCForm] = useState({ account: "", post: "", mine: "" });
  const [comment, setComment] = useState<CommentOut | null>(null);

  const call = (fn: () => Promise<EngageResult>, onOk: (r: EngageResult) => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn().catch(() => ({ ok: false }) as EngageResult);
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      onOk(r);
    });

  const toReel = (r: ReplyOut) =>
    start(async () => {
      const res = await savePostAction(pick.id, null, { platform: "ig", format: "reel", kind: "teach", target: "", date: addDays(today, 1), time: DEFAULT_TIME, topic: r.text.slice(0, 280), body: "", status: "draft" }).catch(() => ({ ok: false, error: undefined }));
      if (!res.ok) return setMsg({ ok: false, text: res.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      setSavedReel((s) => new Set(s).add(r.n));
      setMsg({ ok: true, text: L("已存成明天的 Reel 草稿，到一週看板點開它請 AI 寫腳本。", "Saved as a Reel draft for tomorrow. Open it on the week board to write the script.") });
      router.refresh();
    });

  if (!pick.editable.length) return <p className="muted post-empty">{L("你可以看這些專案，但沒有修改的權限，所以不能用互動小幫手。", "You can view these projects but can't edit them, so the engagement tools are unavailable.")}</p>;
  const counts = replies ? bucketCounts(replies) : null;
  const off = busy || !aiEnabled;

  return (
    <div className="soc-swipes">
      <div className="soc-form-row">
        <div className="seg" role="group" aria-label={L("要做什麼", "Tool")}>
          <button type="button" className={mode === "reply" ? "active" : ""} aria-pressed={mode === "reply"} onClick={() => { setMode("reply"); setMsg(null); }}>{L("回覆留言", "Reply to comments")}</button>
          <button type="button" className={mode === "dm" ? "active" : ""} aria-pressed={mode === "dm"} onClick={() => { setMode("dm"); setMsg(null); }}>{L("寫私訊", "Write a DM")}</button>
          <button type="button" className={mode === "comment" ? "active" : ""} aria-pressed={mode === "comment"} onClick={() => { setMode("comment"); setMsg(null); }}>{L("去別人貼文留言", "Comment on a post")}</button>
        </div>
        <ProjectPick {...pick} />
      </div>
      {!aiEnabled && <p className="muted small">{L("還沒設定 ANTHROPIC_API_KEY，互動小幫手不能用。", "ANTHROPIC_API_KEY isn't set, so these tools are unavailable.")}</p>}

      {mode === "reply" && (
        <>
          <form className="glass panel soc-plan" onSubmit={(e) => { e.preventDefault(); call(() => draftRepliesAction(pick.id, comments, context), (r) => { setReplies(r.replies ?? []); setSavedReel(new Set()); }); }}>
            <label>
              <span>{L("把你貼文下面的留言貼進來（一行一則，前面有「帳號：」更好，最多 60 則）", "Paste the comments under your post (one per line, “handle: text” if you can, up to 60)")}</span>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={6} maxLength={20000} placeholder={"@a：週三\n@b：我們系上也有人在問這個\n@c：會不會被同學看到？"} required />
            </label>
            <label>
              <span>{L("關於這則貼文（選填，但寫了回覆才會準）：在講什麼、你請大家留哪個字、回覆時可以用的事實", "About the post (optional but it helps): what it's about, the keyword you asked for, facts the replies can use")}</span>
              <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} maxLength={1500} placeholder={L("例如：這則在講為什麼只配一個人。留「週三」的人要傳開放通知。配對前資料只有自己看得到。", "For example: what the post says, the keyword and what it unlocks, and any facts you want used.")} />
            </label>
            <footer>
              <span className="muted small grow">{L("只寫草稿，不會幫你回。先回留關鍵字和可能的使用者，發文後第一個小時回最有用。", "Drafts only. Reply to keyword comments and leads first; the first hour matters most.")}</span>
              <button type="submit" className="btn primary small" disabled={off || comments.trim().length < 2}>{busy ? L("AI 處理中…", "Working…") : L("分類並寫回覆", "Sort and draft replies")}</button>
            </footer>
          </form>
          {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
          {replies && counts && (
            <>
              <p className="muted small">{L(`${replies.length} 則：`, `${replies.length} comments: `)}{BUCKETS.filter((b) => counts[b]).map((b) => `${L(...BUCKET_LABEL[b])} ${counts[b]}`).join("・")}</p>
              <ul className="soc-swipe-list">
                {replies.map((r) => (
                  <li key={r.n} className={`glass soc-reply ${r.bucket}`}>
                    <div className="soc-swipe-main">
                      <p className="muted small"><span className="soc-kind" title={L(...BUCKET_HINT[r.bucket])}>{L(...BUCKET_LABEL[r.bucket])}</span> {r.who} {r.text}</p>
                      {r.reply ? <p>{r.reply}</p> : <p className="muted small">{L(...BUCKET_HINT[r.bucket])}</p>}
                      {r.reel && <p className="muted small">{L("很多人都會想問，值得拍成一支 Reel（回覆裡可以直接用影片回）。", "Lots of people will have this question. Worth a Reel.")}</p>}
                    </div>
                    {r.reply && <CopyBtn text={r.reply} />}
                    {r.reel && <button type="button" className="btn small" disabled={busy || savedReel.has(r.n)} onClick={() => toReel(r)}>{savedReel.has(r.n) ? L("已存 ✓", "Saved ✓") : L("存成 Reel 草稿", "Save as Reel draft")}</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {mode === "dm" && (
        <>
          <form className="glass panel soc-plan" onSubmit={(e) => { e.preventDefault(); call(() => draftDmAction(pick.id, { kind: dmKind, ...dmForm }), (r) => setDm(r.dm ?? null)); }}>
            <div className="seg small-seg" role="group" aria-label={L("私訊類型", "DM type")}>
              {DM_KINDS.map((k) => <button key={k} type="button" className={dmKind === k ? "active" : ""} aria-pressed={dmKind === k} onClick={() => setDmKind(k)}>{L(...DM_LABEL[k])}</button>)}
            </div>
            <p className="muted small">{L(...DM_HINT[dmKind])}</p>
            <label>
              <span>{L("對方是誰（帳號、在做什麼）", "Who they are (handle, what they do)")}</span>
              <input value={dmForm.who} onChange={(e) => setDmForm({ ...dmForm, who: e.target.value })} maxLength={300} />
            </label>
            <label>
              <span>{L("今天為什麼傳給他（必填：他留了什麼言、回了哪則限動、發了什麼）", "Why today (required: what they commented, replied to or posted)")}</span>
              <textarea value={dmForm.trigger} onChange={(e) => setDmForm({ ...dmForm, trigger: e.target.value })} rows={2} maxLength={600} required />
            </label>
            <label>
              <span>{L("你要給他的東西（選填：答應的檔案、連結、一個做法）", "What you'll give them (optional)")}</span>
              <input value={dmForm.give} onChange={(e) => setDmForm({ ...dmForm, give: e.target.value })} maxLength={400} />
            </label>
            <label>
              <span>{L("你希望的結果（選填，不一定會寫進訊息）", "What you're hoping for (optional)")}</span>
              <input value={dmForm.want} onChange={(e) => setDmForm({ ...dmForm, want: e.target.value })} maxLength={300} />
            </label>
            <footer>
              <span className="muted small grow">{L("只傳給先跟你互動過的人。大量私訊沒互動過的陌生人，帳號會被平台限制。", "Only message people who engaged first. Bulk DMs to strangers get accounts restricted.")}</span>
              <button type="submit" className="btn primary small" disabled={off || dmForm.trigger.trim().length < 4}>{busy ? L("AI 寫作中…", "Writing…") : L("寫私訊", "Draft the DM")}</button>
            </footer>
          </form>
          {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
          {dm && (
            <ul className="soc-swipe-list">
              {([[L("第一則", "First message"), dm.message], [L("第 4 天還沒回：帶一個新的東西", "Day 4, no reply: add something new"), dm.follow4], [L("第 10 天：最後一則，之後不再傳", "Day 10: the last one"), dm.follow10]] as [string, string][]).filter(([, t]) => t).map(([label, text]) => (
                <li key={label} className="glass">
                  <div className="soc-swipe-main"><p className="muted small">{label}・{L(`${text.length} 字`, `${text.length} chars`)}</p><p className="soc-pre">{text}</p></div>
                  <CopyBtn text={text} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === "comment" && (
        <>
          <form className="glass panel soc-plan" onSubmit={(e) => { e.preventDefault(); call(() => draftCommentsAction(pick.id, cForm), (r) => setComment(r.comment ?? null)); }}>
            <label>
              <span>{L("對方的貼文（把文字貼進來；影片就貼他講的內容或說明文字）", "Their post (paste the text, or what they say in the video)")}</span>
              <textarea value={cForm.post} onChange={(e) => setCForm({ ...cForm, post: e.target.value })} rows={5} maxLength={3000} required />
            </label>
            <div className="soc-form-row">
              <input value={cForm.account} onChange={(e) => setCForm({ ...cForm, account: e.target.value })} placeholder={L("對方帳號（選填）", "Their handle (optional)")} maxLength={60} aria-label={L("對方帳號", "Their handle")} />
              <input className="grow" value={cForm.mine} onChange={(e) => setCForm({ ...cForm, mine: e.target.value })} placeholder={L("你自己相關的經驗或數字（選填，有的話留言會具體很多）", "Your own related experience or numbers (optional)")} maxLength={500} aria-label={L("你自己的經驗或數字", "Your own experience")} />
            </div>
            <footer>
              <span className="muted small grow">{L("每天花 20 分鐘去 10 個帳號留言，比多發一則貼文有用。不推銷、不放連結；早點留，貼文傳開時留言會跟著被看到。", "Twenty minutes a day commenting on ten accounts beats one more post. No pitching, no links, and comment early.")}</span>
              <button type="submit" className="btn primary small" disabled={off || cForm.post.trim().length < 10}>{busy ? L("AI 寫作中…", "Writing…") : L("給我兩種留言", "Give me two options")}</button>
            </footer>
          </form>
          {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
          {comment && (
            <>
              <ul className="soc-swipe-list">
                {comment.options.map((o, i) => (
                  <li key={i} className="glass">
                    <div className="soc-swipe-main"><p className="muted small"><span className="soc-kind">{L(...commentTypeLabel(o.type))}</span></p><p className="soc-pre">{o.text}</p></div>
                    <CopyBtn text={o.text} />
                  </li>
                ))}
              </ul>
              {comment.pick && <p className="muted small">{comment.pick}</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 上傳前把截圖縮到長邊 1600、轉成 JPEG */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** 個人檔案健檢：貼截圖或自己填 → 12 項打 100 分，照扣最多分的順序給改法。每個專案記住上一次的結果 */
export function ProfileView({ projects, current, profiles, aiEnabled }: { projects: SocialProject[]; current: SocialProject | null; profiles: Record<string, ProfileResult>; aiEnabled: boolean }) {
  const L = useL();
  const router = useRouter();
  const pick = useProject(projects, current);
  const viewId = current?.id ?? pick.id;
  const [fresh, setFresh] = useState<Record<string, ProfileResult>>({});
  const result = fresh[viewId] ?? profiles[viewId] ?? null;
  const [fields, setFields] = useState<Record<ProfileField, string>>(() => Object.fromEntries(PROFILE_FIELDS.map((k) => [k, ""])) as Record<ProfileField, string>);
  const [touched, setTouched] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  // 沒動過表單時，帶入這個專案上次填的內容
  const shown = touched ? fields : ({ ...fields, ...(result?.input ?? {}) } as Record<ProfileField, string>);
  const canRun = !!projects.find((p) => p.id === viewId)?.canEdit;

  const run = () =>
    start(async () => {
      setMsg(null);
      const r = await checkProfileAction(viewId, shown, image).catch(() => ({ ok: false }) as EngageResult);
      if (!r.ok || !r.profile) return setMsg({ ok: false, text: r.error ?? L("沒有成功，再試一次。", "That didn't work. Try again.") });
      setFresh((f) => ({ ...f, [viewId]: r.profile! }));
      router.refresh();
    });
  const pickShot = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImage(await shrink(file));
    } catch {
      setMsg({ ok: false, text: L("這張圖片讀不了，換一張 JPG 或 PNG。", "Couldn't read that image. Try a JPG or PNG.") });
    }
  };

  if (!viewId) return <p className="muted post-empty">{L("先選一個專案。", "Pick a project first.")}</p>;

  return (
    <div className="soc-swipes">
      {canRun && (
        <form className="glass panel soc-plan" onSubmit={(e) => { e.preventDefault(); run(); }}>
          <header>
            <b>{L("個人檔案健檢", "Profile check")}</b>
            <ProjectPick {...pick} />
          </header>
          <p className="muted small">{L("陌生人從一支影片點進你的檔案，大約三秒決定要不要追蹤。貼一張個人檔案的截圖（頭像到前兩排貼文），或自己填；兩個都給最準。", "A stranger lands on your profile from one video and decides in about three seconds. Add a screenshot (photo down to the first two grid rows), fill in the fields, or both.")}</p>
          <div className="soc-form-row">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickShot(e.target.files?.[0])} />
            <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>{image ? L("換一張截圖", "Change screenshot") : L("貼個人檔案截圖", "Add a profile screenshot")}</button>
            {image && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="post-thumb" src={image} alt="" />
                <button type="button" className="btn ghost small" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }}>{L("拿掉", "Remove")}</button>
              </>
            )}
          </div>
          <div className="soc-profile-fields">
            {PROFILE_FIELDS.map((k) => (
              <label key={k}>
                <span>{L(...PROFILE_FIELD_LABEL[k])}</span>
                {k === "bio" || k === "grid" ? (
                  <textarea value={shown[k] ?? ""} onChange={(e) => { setTouched(true); setFields({ ...shown, [k]: e.target.value }); }} rows={2} maxLength={600} />
                ) : (
                  <input value={shown[k] ?? ""} onChange={(e) => { setTouched(true); setFields({ ...shown, [k]: e.target.value }); }} maxLength={300} />
                )}
              </label>
            ))}
          </div>
          {!aiEnabled && <p className="muted small">{L("還沒設定 ANTHROPIC_API_KEY，檔案健檢不能用。", "ANTHROPIC_API_KEY isn't set, so the profile check is unavailable.")}</p>}
          {msg && <p className={msg.ok ? "notice glass" : "error"} role="status">{msg.text}</p>}
          <footer>
            <span className="muted small grow">{L("沒提供的項目會給 0 分並寫「沒辦法評」，不會用猜的。", "Anything you don't provide scores 0 and is marked as not assessed.")}</span>
            <button type="submit" className="btn primary small" disabled={busy || !aiEnabled}>{busy ? L("AI 健檢中…", "Checking…") : result ? L("重新健檢", "Check again") : L("開始健檢", "Run the check")}</button>
          </footer>
        </form>
      )}

      {result ? (
        <>
          <p className="soc-score"><b>{result.total} / {PROFILE_TOTAL}</b><span className="muted small">{L(`${+result.at.slice(5, 7)}/${+result.at.slice(8, 10)} 健檢・照扣最多分的排，從上面開始改`, `Checked ${result.at.slice(0, 10)} · biggest losses first`)}</span></p>
          <ul className="soc-swipe-list">
            {result.items.map((i) => (
              <li key={i.id} className="glass soc-rubric">
                <div className="soc-swipe-main">
                  <p className="soc-rubric-head"><b>{L(...rubricLabel(i.id))}</b><span className="muted small">{i.score} / {i.points}</span><span className="soc-meter" aria-hidden><i style={{ width: `${Math.round((i.score / i.points) * 100)}%` }} /></span></p>
                  {i.note && <p className="muted small">{i.note}</p>}
                  {i.fix && <p className="soc-pre">{i.fix}</p>}
                </div>
                {i.fix && <CopyBtn text={i.fix} />}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted post-empty">{canRun ? L("這個專案還沒健檢過。", "This project hasn't been checked yet.") : L("這個專案還沒有健檢結果。", "No profile check for this project yet.")}</p>
      )}
    </div>
  );
}
