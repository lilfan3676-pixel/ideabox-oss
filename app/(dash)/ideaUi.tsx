"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type LiHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useL } from "../LangProvider";
import { IconArrowUpRight, IconClose, IconGithub, IconGrid, IconInstagram, IconList, IconThreads } from "./icons";

// ---------- 卡片的拖曳與勾選（點子庫傳進來，卡片本身不用管邏輯） ----------

export type CardExtra = {
  li?: LiHTMLAttributes<HTMLLIElement>;
  className?: string;
  check?: ReactNode;
};

// 採用、加入簡報這類開關：按下去畫面立刻切換，背景再存（由 IdeasView 提供）
export type FlagKey = "adopted" | "in_brief";
export const FlagToggle = createContext<(id: string, key: FlagKey, to: boolean) => void>(() => {});
export const useFlagToggle = () => useContext(FlagToggle);

// ---------- 原文來源按鈕 ----------

export function sourceOf(url: string | null | undefined): { name: string; Icon: typeof IconThreads } | null {
  if (!url) return null;
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (host.endsWith("threads.net") || host.endsWith("threads.com")) return { name: "Threads", Icon: IconThreads };
  if (host === "github.com") return { name: "GitHub", Icon: IconGithub };
  if (host.endsWith("instagram.com")) return { name: "Instagram", Icon: IconInstagram };
  return { name: host, Icon: IconArrowUpRight };
}

/** 卡片右上角固定的來源圖示：一點就在新分頁開原文 */
export function SourceButton({ url, size = "md" }: { url: string | null | undefined; size?: "md" | "lg" }) {
  const s = sourceOf(url);
  const L = useL();
  if (!s || !url) return null;
  const label = L(`在 ${s.name} 開啟原文`, `Open on ${s.name}`);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`src-btn ${size}`}
      aria-label={label}
      title={label}
      onClick={(e) => e.stopPropagation()}
    >
      <s.Icon size={size === "lg" ? 18 : 16} />
      {size === "lg" && <span>{label}</span>}
      {size === "lg" && <IconArrowUpRight size={14} />}
    </a>
  );
}

// ---------- 格狀／列表切換（每頁各自記住，只存在這台裝置） ----------

export type Layout = "grid" | "list";

export function useLayout(key: string): [Layout, (l: Layout) => void] {
  const [layout, setLayout] = useState<Layout>("grid");
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v === "grid" || v === "list") setLayout(v);
    } catch {
      /* 無痕模式等情況讀不到，用預設 */
    }
  }, [key]);
  const set = useCallback(
    (l: Layout) => {
      setLayout(l);
      try {
        localStorage.setItem(key, l);
      } catch {
        /* 忽略 */
      }
    },
    [key],
  );
  return [layout, set];
}

export function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  const L = useL();
  return (
    <div className="seg layout-toggle" role="radiogroup" aria-label={L("顯示方式", "Layout")}>
      <button type="button" role="radio" aria-checked={layout === "grid"} className={layout === "grid" ? "active" : ""} onClick={() => onChange("grid")} aria-label={L("格狀", "Grid")} title={L("格狀", "Grid")}>
        <IconGrid size={16} />
      </button>
      <button type="button" role="radio" aria-checked={layout === "list"} className={layout === "list" ? "active" : ""} onClick={() => onChange("list")} aria-label={L("列表", "List")} title={L("列表", "List")}>
        <IconList size={16} />
      </button>
    </div>
  );
}

// ---------- 右鍵選單 ----------

/** 在滑鼠位置跳出的選單：點外面、按 Esc、捲動或縮放視窗就關掉；不會超出畫面 */
export function ContextMenu({ x, y, onClose, label, children }: { x: number; y: number; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // onClose 放在 ref：父層重畫（例如每幾秒更新、儲存中）時不要重新定位、搶走輸入框的焦點
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
      el.querySelector<HTMLElement>("button, input, select")?.focus();
    }
    const done = () => closeRef.current();
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if ((e.type === "pointerdown" || e.type === "contextmenu") && ref.current?.contains(e.target as Node)) return;
      done();
    };
    // 選單本身捲動（資料夾很多時）不算；正在選單裡打字時（手機鍵盤跳出會捲動畫面）也不算
    const onScroll = (e: Event) => {
      const box = ref.current;
      if (!box || (e.target instanceof Node && box.contains(e.target))) return;
      const a = document.activeElement;
      if (a && box.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      done();
    };
    const opts = { capture: true };
    window.addEventListener("pointerdown", close, opts);
    window.addEventListener("contextmenu", close, opts);
    window.addEventListener("keydown", close, opts);
    window.addEventListener("scroll", onScroll, opts);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", close, opts);
      window.removeEventListener("contextmenu", close, opts);
      window.removeEventListener("keydown", close, opts);
      window.removeEventListener("scroll", onScroll, opts);
      window.removeEventListener("resize", onScroll);
    };
  }, [x, y]);

  if (typeof document === "undefined") return null;
  // 掛到 body：頁面進場動畫的 transform 會讓 fixed 定位跑掉
  return createPortal(
    <div ref={ref} className="ctx-menu glass" role="menu" aria-label={label} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

// ---------- 右側詳細面板（手機為底部抽屜） ----------

export function DetailPanel({
  open,
  onClose,
  title,
  url,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  url?: string | null;
  children: React.ReactNode;
}) {
  // closing：播放收起動畫後才真正移除
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<Element | null>(null);
  const L = useL();

  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement;
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
        (lastFocus.current as HTMLElement | null)?.focus?.();
      }, reduce ? 0 : 220);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 開啟時：Esc 關閉、鎖住背景捲動、焦點移進面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className={`drawer-root ${closing ? "closing" : ""}`}>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <div className="drawer glass" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <div className="drawer-head">
          <span className="drawer-grip" aria-hidden />
          <SourceButton url={url} size="lg" />
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

// ---------- 詳情裡的分數區：左邊大字綜合分數，右邊三項橫條 ----------

export function ScoreBlock({ total, rows }: { total: number; rows: { label: string; n: number | null }[] }) {
  const L = useL();
  return (
    <div className="detail-scores">
      <div className="score-big">
        <span className="kpi-label">{L("綜合分數", "Overall")}</span>
        <b>{total}</b>
      </div>
      <div className="score-bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.label}>
            <span className="bar-label">{r.label}</span>
            <span className="bar-track" aria-hidden><i style={{ width: `${Math.max(0, Math.min(10, r.n ?? 0)) * 10}%` }} /></span>
            <span className="bar-n">{r.n ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
