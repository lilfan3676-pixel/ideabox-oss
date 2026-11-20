// 外觀：App 2.0 固定一套黑底配色（NOIR），不再跟網頁主題走、也沒有主題選項
import { useMemo } from "react";

export type ThemeName = "fluento" | "ember" | "portal";
export type Mode = "light" | "dark";

export type Palette = {
  name: ThemeName;
  mode: Mode;
  dark: boolean;
  /** 背景三段漸層＋兩團光暈（跟網頁 .app-bg 一樣） */
  bgA: string;
  bgB: string;
  bgC: string;
  blob1: string;
  blob2: string;
  /** 卡片（網頁的 .glass） */
  card: string;
  cardPressed: string;
  border: string;
  borderWidth: number;
  radius: number;
  /** 小元件（標籤、按鈕）的圓角 */
  radiusSm: number;
  shadow: string;
  text: string;
  muted: string;
  faint: string;
  sep: string;
  field: string;
  accent: string;
  accentSoft: string;
  /** 主要按鈕（網頁 .btn.primary） */
  ink: string;
  inkText: string;
  ok: string;
  warn: string;
  danger: string;
  /** Portal 專用的強調色（區塊標題、硬陰影） */
  pop: string;
};

const base = { borderWidth: 1, radius: 22, radiusSm: 999 };

/**
 * App 2.0 的外觀：純黑底、白字、霓虹黃重點色、彩色漸層磚（使用者 2026-11-20 選的「B 版」，照參考影片）。
 * 不再跟網頁的主題走；name 沿用 fluento 只是為了走「圓角」那一支樣式。
 */
export const NOIR: Palette = {
  ...base, name: "fluento", mode: "dark", dark: true,
  bgA: "#000000", bgB: "#000000", bgC: "#000000", blob1: "rgba(0,0,0,0)", blob2: "rgba(0,0,0,0)",
  card: "rgba(255,255,255,0.07)", cardPressed: "rgba(255,255,255,0.14)", border: "rgba(255,255,255,0.14)",
  shadow: "0px 0px 0px rgba(0,0,0,0)",
  text: "#ffffff", muted: "rgba(255,255,255,0.62)", faint: "rgba(255,255,255,0.38)", sep: "rgba(255,255,255,0.1)", field: "rgba(255,255,255,0.08)",
  accent: "#e6f24b", accentSoft: "rgba(230,242,75,0.16)", ink: "#ffffff", inkText: "#000000",
  ok: "#7dffb0", warn: "#ffd23f", danger: "#ff6b80", pop: "#e6f24b",
};

/** 每個專案／產品一組漸層（光環磚、專案卡用）：[中心, 中圈, 外圈] */
export const HALOS: [string, string, string][] = [
  ["#a8301c", "#6f9a62", "#4a7f9c"],
  ["#0f7f86", "#4f9a78", "#5a8a4a"],
  ["#e0457f", "#8a2a7a", "#4a2a8c"],
  ["#2f47c8", "#1a2a8c", "#05081c"],
  ["#c9963f", "#a06a48", "#7a4d34"],
  ["#7f8f1e", "#4f5a16", "#2a300c"],
];
export const halo = (i: number) => {
  const [a, b, c] = HALOS[((i % HALOS.length) + HALOS.length) % HALOS.length];
  return `radial-gradient(circle at 50% 56%, ${a} 0%, ${a} 12%, ${b} 46%, ${c} 100%)`;
};

/** 光環漸層，中心放在指定位置（大卡用：例如 "72% 30%"） */
export const haloAt = (i: number, at: string) => {
  const [a, b, c] = HALOS[((i % HALOS.length) + HALOS.length) % HALOS.length];
  return `radial-gradient(circle at ${at}, ${a} 0%, ${a} 10%, ${b} 48%, ${c} 100%)`;
};

export function useTheme(): Palette {
  return NOIR;
}

/** 依配色產生樣式（配色沒變就不重算） */
export function useStyles<T>(make: (t: Palette) => T): T {
  const t = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => make(t), [t]);
}

/** 專案顏色：跟網頁專案頁、辦公室同一組，照專案排序依序分配 */
export const PROJECT_COLORS = ["#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#ef4444", "#94a3b8"];
