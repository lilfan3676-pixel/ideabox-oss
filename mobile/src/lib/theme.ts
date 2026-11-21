// 外觀：照 ideabox 網頁的黑白主題（globals.css 的 [data-theme="mono"]）。
// 純白或純黑底、主色只有黑白，專案顏色與狀態的綠紅照舊；深淺色預設跟手機，設定頁可以自己選。
import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { usePrefs } from "./prefs";

export type Palette = {
  dark: boolean;
  bg: string;
  ink: string;
  muted: string;
  /** 淡灰底的卡片與圓鈕 */
  card: string;
  line: string;
  /** 進度條還沒走到的那幾段 */
  track: string;
  /** 清單拉出來時後面的底色、清單自己的底色 */
  dim: string;
  sheet: string;
  handle: string;
  ok: string;
  bad: string;
  badText: string;
  /** 小球：白底是黑球，黑底是白球 */
  ball: string;
  ballBase: string;
  eye: string;
  ballShadow: string | undefined;
  /** 選單按鈕的實心底（蓋在會捲動的內容上） */
  solid: string;
};

export const LIGHT: Palette = {
  dark: false, bg: "#ffffff", ink: "#111113", muted: "#6b6b73", card: "rgba(0,0,0,0.035)", line: "rgba(0,0,0,0.1)", track: "rgba(0,0,0,0.12)",
  dim: "#ececee", sheet: "#ffffff", handle: "rgba(0,0,0,0.2)", ok: "#1f9d55", bad: "#d14a35", badText: "#b93a23",
  ball: "radial-gradient(circle at 32% 28%, #3a3a3e 0%, #161618 50%, #0b0b0c 100%)", ballBase: "#161618", eye: "#ffffff",
  ballShadow: "0px 24px 32px -18px rgba(0,0,0,0.3)", solid: "#f6f6f6",
};

export const DARK: Palette = {
  dark: true, bg: "#000000", ink: "#f1f1f3", muted: "#9b9ba3", card: "rgba(255,255,255,0.06)", line: "rgba(255,255,255,0.14)", track: "rgba(255,255,255,0.18)",
  dim: "#000000", sheet: "#141416", handle: "rgba(255,255,255,0.28)", ok: "#3ecf7a", bad: "#ff6a55", badText: "#ff7a66",
  ball: "radial-gradient(circle at 32% 28%, #ffffff 0%, #ececee 50%, #c9c9cd 100%)", ballBase: "#ececee", eye: "#111113",
  ballShadow: undefined, solid: "#141416",
};

export const FONT = "Huninn_400Regular";

export function useTheme(): Palette {
  const { look } = usePrefs();
  const sys = useColorScheme();
  return (look === "system" ? sys === "dark" : look === "dark") ? DARK : LIGHT;
}

/** 依配色產生樣式（配色沒變就不重算） */
export function useStyles<T>(make: (t: Palette) => T): T {
  const t = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => make(t), [t]);
}

/** 專案顏色：跟網頁專案頁、辦公室同一組，照專案排序依序分配 */
export const PROJECT_COLORS = ["#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#ef4444", "#94a3b8"];
