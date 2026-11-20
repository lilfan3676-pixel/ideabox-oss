"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useL } from "../LangProvider";
import type { AssistantAnim, AssistantLine } from "@/lib/assistantLogic";
import { assistantLinesAction } from "./assistantActions";

// 分格動畫：public/assistant/<名稱>.png 是一張橫排的圖，每格 168×182
const SHEETS: Record<AssistantAnim, { frames: number; fps: number }> = {
  idle: { frames: 7, fps: 6 },
  wave: { frames: 4, fps: 6 },
  nod: { frames: 8, fps: 8 },
  think: { frames: 6, fps: 5 },
  ponder: { frames: 6, fps: 5 },
  shrug: { frames: 6, fps: 7 },
};
const KEY = "ib-assistant"; // "hidden"＝不顯示
const SIZE_KEY = "ib-assistant-size";
/** 設定頁改了顯示或大小時發這個事件，畫面上的小助手馬上跟著變 */
export const ASSISTANT_EVENT = "ib-assistant-change";
export const ASSISTANT_SIZES = { s: 68, m: 96, l: 136 } as const;
export type AssistantSize = keyof typeof ASSISTANT_SIZES;

export function readAssistantPrefs(): { hidden: boolean; size: AssistantSize } {
  try {
    const size = localStorage.getItem(SIZE_KEY);
    return { hidden: localStorage.getItem(KEY) === "hidden", size: size === "s" || size === "l" ? size : "m" };
  } catch {
    return { hidden: false, size: "m" };
  }
}
export function saveAssistantPrefs(next: { hidden?: boolean; size?: AssistantSize }) {
  try {
    if (next.hidden !== undefined) localStorage.setItem(KEY, next.hidden ? "hidden" : "shown");
    if (next.size) localStorage.setItem(SIZE_KEY, next.size);
  } catch {
    /* 存不了就只在這次有效 */
  }
  window.dispatchEvent(new Event(ASSISTANT_EVENT));
}

/**
 * 右下角的小助手（原本在手機 App，使用者 2026-11-20 要搬到網站）。
 * 操作只有一件事（使用者 2026-11-20 要更簡單直觀）：**點他＝打開或關掉泡泡**。
 * 進站時自己講最重要的一句；有幾件事，頭上的數字就是幾；泡泡裡「去看看」到那一頁、‹ › 換上一句下一句。
 * 要不要顯示、大小（小／中／大）在「設定 → 外觀」調，記在這台瀏覽器的 localStorage。
 * 只給主人、只在電腦版顯示（手機版右下角是分頁列）。掛在 body 上，避免頁面進場的 transform 讓 fixed 失效。
 * 圖檔不在公開版裡：讀不到圖就整個不顯示。
 */
export function WebAssistant() {
  const L = useL();
  const [mounted, setMounted] = useState(false);
  const [prefs, setPrefs] = useState<{ hidden: boolean; size: AssistantSize }>({ hidden: false, size: "m" });
  const [broken, setBroken] = useState(false);
  const [lines, setLines] = useState<AssistantLine[]>([]);
  const [idx, setIdx] = useState(0);
  const [bubble, setBubble] = useState(false);
  const [anim, setAnim] = useState<AssistantAnim>("idle");
  const [frame, setFrame] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const sync = () => setPrefs(readAssistantPrefs());
    sync();
    window.addEventListener(ASSISTANT_EVENT, sync);
    const off = () => window.removeEventListener(ASSISTANT_EVENT, sync);
    // 手機版不顯示小助手（CSS 藏起來），就不用查資料、也不用載圖
    if (window.matchMedia("(max-width: 720px)").matches) return off;
    const img = new Image();
    img.onerror = () => setBroken(true);
    img.src = "/assistant/idle.png";
    let dead = false;
    assistantLinesAction()
      .then((ls) => {
        if (dead || !ls.length) return;
        setLines(ls);
        timer.current = setTimeout(() => say(ls, 0, true), 1200);
      })
      .catch(() => null);
    return () => {
      dead = true;
      off();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** auto：進站自己開口的那一次，12 秒後自己收起來；使用者自己點開的不會自己關 */
  const say = (ls: AssistantLine[], n: number, auto = false) => {
    if (!ls.length) return;
    const i = ((n % ls.length) + ls.length) % ls.length;
    setIdx(i);
    setAnim(ls[i].anim);
    setBubble(true);
    if (timer.current) clearTimeout(timer.current);
    if (auto) timer.current = setTimeout(close, 12000);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    setBubble(false);
    setAnim("idle");
  };

  // 一格一格播；系統開了「減少動態效果」就停在第一格
  useEffect(() => {
    setFrame(0);
    if (prefs.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { frames, fps } = SHEETS[anim];
    const t = setInterval(() => setFrame((f) => (f + 1) % frames), 1000 / fps);
    return () => clearInterval(t);
  }, [anim, prefs.hidden]);

  if (!mounted || broken || prefs.hidden) return null;
  const H = ASSISTANT_SIZES[prefs.size];
  const W = Math.round((168 * H) / 182);
  const line = lines[idx];
  return createPortal(
    <div className="web-assistant">
      {bubble && line ? (
        <div className="web-assistant-bubble" role="status">
          <button type="button" className="web-assistant-x" onClick={close} aria-label={L("關掉", "Close")}>×</button>
          <p>{line.text}</p>
          <div className="web-assistant-acts">
            {line.href ? <Link href={line.href} className="go" onClick={close}>{L("去看看 →", "Open →")}</Link> : <span />}
            {lines.length > 1 ? (
              <span className="pager">
                <button type="button" onClick={() => say(lines, idx - 1)} aria-label={L("上一句", "Previous")}>‹</button>
                <i>{idx + 1}/{lines.length}</i>
                <button type="button" onClick={() => say(lines, idx + 1)} aria-label={L("下一句", "Next")}>›</button>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="web-assistant-body"
        onClick={() => (bubble ? close() : say(lines, idx))}
        aria-expanded={bubble}
        aria-label={L(`小助手：有 ${lines.length} 件事要跟你說，點一下${bubble ? "關掉" : "打開"}`, `Assistant: ${lines.length} notes, click to ${bubble ? "close" : "open"}`)}
        style={{ width: W, height: H }}
      >
        <span className="clip" style={{ width: W, height: H }}>
        <span
          aria-hidden
          className="sheet"
          style={{ width: W * SHEETS[anim].frames, height: H, backgroundImage: `url(/assistant/${anim}.png)`, backgroundSize: `${W * SHEETS[anim].frames}px ${H}px`, transform: `translateX(${-frame * W}px)` }}
        />
        </span>
        {!bubble && lines.length ? <b className="web-assistant-count" aria-hidden>{lines.length}</b> : null}
      </button>
    </div>,
    document.body,
  );
}
