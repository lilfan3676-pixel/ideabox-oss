"use client";

import type { Idea } from "@/lib/db";
import { formatStars, timeAgo } from "@/lib/format";
import { catLabel } from "@/lib/labels";
import { useL, useLang } from "@/app/LangProvider";
import type { Translate } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/scoring";
import { deleteIdea, saveNote, setCategory } from "./actions";
import { AutoSelect, ConfirmButton, SubmitButton } from "./ConfirmButton";
import { IconStar } from "./icons";
import { DupNotice } from "./DupNotice";
import { ScoreBlock, SourceButton, useFlagToggle, type CardExtra } from "./ideaUi";

// 設計類（介面設計、GitHub）的卡片、列表列與詳情：跟一般點子放在同一個點子庫，只是長相不同

const statusText = (L: Translate, s: Idea["status"]) =>
  s === "failed" ? L("分析失敗", "Analysis failed") : s === "needs_input" ? L("待補充", "Needs input") : L("分析中", "Analyzing");
const catOptions = (lang: "zh" | "en") => CATEGORIES.map((c) => [c, catLabel(c, lang)] as [string, string]);

function GhMeta({ idea: i, now }: { idea: Idea; now: number }) {
  const L = useL();
  const lang = useLang();
  const gh = i.design?.github;
  if (!gh) return null;
  return (
    <p className="gh-meta">
      <span><IconStar size={13} /> {formatStars(gh.stars)}</span>
      {gh.language && <span>{gh.language}</span>}
      {gh.license && <span>{gh.license}</span>}
      {gh.pushed_at && <span>{L("更新於", "Updated")} {timeAgo(gh.pushed_at, now, lang)}</span>}
    </p>
  );
}

function BriefButton({ idea: i }: { idea: Idea }) {
  const L = useL();
  const toggle = useFlagToggle();
  return (
    <button className={`btn small ${i.in_brief ? "primary" : ""}`} type="button" aria-pressed={!!i.in_brief} onClick={() => toggle(i.id, "in_brief", !i.in_brief)}>
      {i.in_brief ? L("✓ 已加入簡報", "✓ In brief") : L("加入簡報", "Add to brief")}
    </button>
  );
}

/** 標記採用（跟一般點子卡片同一顆按鈕） */
function AdoptToggle({ idea: i, className = "" }: { idea: Idea; className?: string }) {
  const L = useL();
  const toggle = useFlagToggle();
  return (
    <button
      type="button"
      aria-pressed={!!i.adopted}
      onClick={() => toggle(i.id, "adopted", !i.adopted)}
      className={`btn small adopt-btn ${i.adopted ? "on" : ""} ${className}`}
      title={i.adopted ? L("點一下取消採用", "Click to unadopt") : L("點一下標記已採用", "Click to mark as adopted")}
    >
      {i.adopted ? L("✓ 已採用", "✓ Adopted") : L("＋ 標記採用", "+ Adopt")}
    </button>
  );
}

/** 列表模式的採用標籤（跟一般點子的列表一樣） */
function RowAdoptTag({ idea: i }: { idea: Idea }) {
  const L = useL();
  const toggle = useFlagToggle();
  return (
    <button
      type="button"
      aria-pressed={!!i.adopted}
      onClick={() => toggle(i.id, "adopted", !i.adopted)}
      className={`adopt-tag ${i.adopted ? "on" : ""}`}
      title={i.adopted ? L("點一下改成未採用", "Click to mark as not adopted") : L("點一下標記已採用", "Click to mark as adopted")}
    >
      {i.adopted ? L("✓ 已採用", "✓ Adopted") : L("未採用", "Not adopted")}
    </button>
  );
}

export function DesignCard({ idea: i, img, now, onOpen, extra }: { idea: Idea; img?: string; now: number; onOpen: () => void; extra?: CardExtra }) {
  const L = useL();
  const lang = useLang();
  const d = i.design ?? {};
  return (
    <li {...extra?.li} className={`glass design-card lift ${i.in_brief ? "picked" : ""} ${i.adopted ? "adopted" : ""} ${extra?.className ?? ""}`}>
      {extra?.check}
      {img && (
        <button type="button" className="thumb" onClick={onOpen} aria-label={L("看完整內容", "Open details")}>
          {/* 簽名網址會過期，不適合用 next/image 快取 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={i.summary ?? L("設計預覽", "Design preview")} loading="lazy" />
        </button>
      )}
      <div className="design-body">
        <div className="idea-head">
          <form action={setCategory} className="inline">
            <input type="hidden" name="id" value={i.id} />
            <AutoSelect name="category" defaultValue={i.category ?? "ui_design"} options={catOptions(lang)} />
          </form>
          {i.status !== "analyzed" && <span className={`badge ${i.status}`}>{statusText(L, i.status)}</span>}
          {i.score_total !== null && <span className="score-chip" title={L("可套用、好實作、參考價值的綜合分數", "Overall of applicability, ease and reference value")}>{i.score_total}</span>}
          <SourceButton url={i.url} />
        </div>

        <button type="button" className="title-btn summary idea-lite-title" onClick={onOpen} title={L("看完整內容", "Open details")}>
          {i.summary ?? i.url}
        </button>

        <GhMeta idea={i} now={now} />
        {!!d.styles?.length && <p className="chips">{d.styles.map((s) => <span key={s}>{s}</span>)}</p>}
        {/* 學到什麼收在細節裡，卡片只留一句可以怎麼用，讓每張卡片差不多高 */}
        {d.apply && <p className="next idea-lite-next">👉 {d.apply}</p>}
        <DupNotice idea={i} />

        <div className="actions design-foot">
          <AdoptToggle idea={i} className="push-left" />
          <button type="button" className="btn ghost small" onClick={onOpen}>{L("看細節", "Details")} →</button>
          <BriefButton idea={i} />
        </div>
      </div>
    </li>
  );
}

/** 列表模式：小縮圖、分類、摘要、可以怎麼用、分數、原文 */
export function DesignRow({ idea: i, img, onOpen, extra }: { idea: Idea; img?: string; onOpen: () => void; extra?: CardExtra }) {
  const L = useL();
  const lang = useLang();
  return (
    <li {...extra?.li} className={`glass idea-row design-row ${i.in_brief ? "picked" : ""} ${i.adopted ? "adopted" : ""} ${extra?.className ?? ""}`}>
      {extra?.check}
      <button type="button" className="row-thumb" onClick={onOpen} aria-label={L("看完整內容", "Open details")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden>🎨</span>}
      </button>
      <span className="row-cat">{catLabel(i.category, lang)}</span>
      <div className="row-main">
        <button type="button" className="title-btn row-title" onClick={onOpen} title={L("看完整內容", "Open details")}>
          {i.summary ?? i.url}
        </button>
        {i.design?.apply && <span className="row-next">👉 {i.design.apply}</span>}
      </div>
      <div className="row-adopt">
        <RowAdoptTag idea={i} />
      </div>
      <span className="row-score">{i.score_total ?? "—"}</span>
      <SourceButton url={i.url} />
    </li>
  );
}

export function DesignDetail({ idea: i, img, now, picks }: { idea: Idea; img?: string; now: number; picks?: React.ReactNode }) {
  const L = useL();
  const lang = useLang();
  const d = i.design ?? {};
  return (
    <div className="detail">
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="detail-img" src={img} alt={i.summary ?? L("設計預覽", "Design preview")} />
      )}
      <div className="idea-head">
        <form action={setCategory} className="inline">
          <input type="hidden" name="id" value={i.id} />
          <AutoSelect name="category" defaultValue={i.category ?? "ui_design"} options={catOptions(lang)} />
        </form>
        {i.status !== "analyzed" && <span className={`badge ${i.status}`}>{statusText(L, i.status)}</span>}
        <span className="muted small push">{i.author ? `${i.author}・` : ""}{timeAgo(i.created_at, now, lang)}</span>
      </div>
      <h2 className="detail-title">{i.summary ?? i.url}</h2>
      <DupNotice idea={i} />
      <GhMeta idea={i} now={now} />

      {i.score_total !== null && (
        <ScoreBlock total={i.score_total} rows={[{ label: L("可套用", "Applicable"), n: i.score_arx }, { label: L("好實作", "Easy to build"), n: i.score_feasibility }, { label: L("參考價值", "Reference value"), n: i.score_market }]} />
      )}
      {!!d.styles?.length && <p className="chips">{d.styles.map((s) => <span key={s}>{s}</span>)}</p>}
      {!!d.learn?.length && (
        <>
          <h3 className="detail-h">{L("可以學的地方", "What to learn")}</h3>
          <ul className="learn">{d.learn.map((l) => <li key={l}>{l}</li>)}</ul>
        </>
      )}
      {d.apply && (
        <div className="detail-next">
          <span className="kpi-label">{L("可以怎麼用", "How to apply it")}</span>
          <p>{d.apply}</p>
        </div>
      )}
      {picks}

      <h3 className="detail-h">{L("原文", "Original post")}</h3>
      {i.content ? <p className="content">{i.content}</p> : <p className="muted small">{L("沒有抓到原文內容。", "Couldn’t fetch the original text.")}</p>}

      <h3 className="detail-h">{L("我的補充", "My notes")}</h3>
      <form action={saveNote} className="note-form" key={i.note ?? ""}>
        <input type="hidden" name="id" value={i.id} />
        <textarea name="note" rows={3} defaultValue={i.note ?? ""} placeholder={L("補一句你想學的重點，AI 會重新分析", "Note what you want to learn — the AI will re-analyze")} />
        <SubmitButton label={L("儲存並重新分析", "Save & re-analyze")} pending={L("分析中…", "Analyzing…")} />
      </form>

      <div className="actions detail-actions">
        <AdoptToggle idea={i} />
        <BriefButton idea={i} />
        <form action={deleteIdea}>
          <input type="hidden" name="id" value={i.id} />
          <ConfirmButton label={L("刪除", "Delete")} message={L("確定刪除這則收藏？", "Delete this saved design?")} />
        </form>
      </div>
    </div>
  );
}
