// 主題：跟 ideabox 網頁一樣的三套配色（Fluento／Ember／Portal × 淺色／深色）
// 預設跟著網頁目前選的（首頁 API 帶回來），App 設定頁也能自己選；選擇存在鑰匙圈，下次打開直接套用
import * as SecureStore from "expo-secure-store";
import { useMemo, useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

export type ThemeName = "fluento" | "ember" | "portal";
export type Mode = "light" | "dark";
export type ThemePref = { theme: ThemeName | "web"; mode: Mode | "web" | "system" };

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

const PALETTES: Record<ThemeName, Record<Mode, Palette>> = {
  fluento: {
    light: {
      ...base, name: "fluento", mode: "light", dark: false,
      bgA: "#eef0fb", bgB: "#efe8f8", bgC: "#fbe4ef", blob1: "rgba(167,150,255,0.45)", blob2: "rgba(255,170,205,0.4)",
      card: "rgba(255,255,255,0.62)", cardPressed: "rgba(255,255,255,0.85)", border: "rgba(255,255,255,0.8)",
      shadow: "0px 10px 30px rgba(80,70,140,0.12)",
      text: "#1c1d29", muted: "#7b7f96", faint: "rgba(123,127,150,0.6)", sep: "rgba(28,29,41,0.08)", field: "rgba(255,255,255,0.7)",
      accent: "#7563f0", accentSoft: "rgba(117,99,240,0.14)", ink: "#15161f", inkText: "#ffffff",
      ok: "#1f9d6b", warn: "#c97a10", danger: "#d6455d", pop: "#7563f0",
    },
    dark: {
      ...base, name: "fluento", mode: "dark", dark: true,
      bgA: "#0d0e19", bgB: "#161430", bgC: "#231633", blob1: "rgba(117,99,240,0.35)", blob2: "rgba(220,90,160,0.25)",
      card: "rgba(255,255,255,0.06)", cardPressed: "rgba(255,255,255,0.12)", border: "rgba(255,255,255,0.1)",
      shadow: "0px 10px 30px rgba(0,0,0,0.35)",
      text: "#eceaf6", muted: "#9a98b3", faint: "rgba(154,152,179,0.6)", sep: "rgba(255,255,255,0.08)", field: "rgba(255,255,255,0.07)",
      accent: "#9d8fff", accentSoft: "rgba(157,143,255,0.18)", ink: "#f2f1fa", inkText: "#14141c",
      ok: "#4fd29a", warn: "#f5b04a", danger: "#ff7a8a", pop: "#9d8fff",
    },
  },
  ember: {
    light: {
      ...base, name: "ember", mode: "light", dark: false,
      bgA: "#fbf2ea", bgB: "#fde8da", bgC: "#f9dcd2", blob1: "rgba(255,170,110,0.45)", blob2: "rgba(255,130,120,0.32)",
      card: "rgba(255,255,255,0.62)", cardPressed: "rgba(255,255,255,0.85)", border: "rgba(255,255,255,0.8)",
      shadow: "0px 10px 30px rgba(150,80,40,0.12)",
      text: "#1c1d29", muted: "#8f7c72", faint: "rgba(143,124,114,0.6)", sep: "rgba(28,29,41,0.08)", field: "rgba(255,255,255,0.7)",
      accent: "#e8692a", accentSoft: "rgba(232,105,42,0.14)", ink: "#15161f", inkText: "#ffffff",
      ok: "#1f9d6b", warn: "#c97a10", danger: "#d6455d", pop: "#e8692a",
    },
    dark: {
      ...base, name: "ember", mode: "dark", dark: true,
      bgA: "#120c0a", bgB: "#22140e", bgC: "#2c1813", blob1: "rgba(255,130,60,0.3)", blob2: "rgba(230,80,70,0.22)",
      card: "rgba(255,255,255,0.06)", cardPressed: "rgba(255,255,255,0.12)", border: "rgba(255,255,255,0.1)",
      shadow: "0px 10px 30px rgba(0,0,0,0.35)",
      text: "#eceaf6", muted: "#b09a8f", faint: "rgba(176,154,143,0.6)", sep: "rgba(255,255,255,0.08)", field: "rgba(255,255,255,0.07)",
      accent: "#ff9257", accentSoft: "rgba(255,146,87,0.18)", ink: "#f2f1fa", inkText: "#14141c",
      ok: "#4fd29a", warn: "#f5b04a", danger: "#ff7a8a", pop: "#ff9257",
    },
  },
  // Portal：直角、粗框、直角硬陰影（漫畫印刷感）
  portal: {
    light: {
      name: "portal", mode: "light", dark: false, borderWidth: 2, radius: 0, radiusSm: 2,
      bgA: "#fbf1f8", bgB: "#f2e4f1", bgC: "#ffc7e4", blob1: "rgba(255,138,31,0.2)", blob2: "rgba(181,21,122,0.28)",
      card: "#ffffff", cardPressed: "#fff6ee", border: "#7f6599",
      shadow: "4px 4px 0px #1a0d29",
      text: "#1a0d29", muted: "#5e4a74", faint: "rgba(94,74,116,0.6)", sep: "rgba(127,101,153,0.35)", field: "#f2e4f1",
      accent: "#b84f00", accentSoft: "rgba(184,79,0,0.12)", ink: "#b84f00", inkText: "#ffffff",
      ok: "#1f7a52", warn: "#8a5a00", danger: "#c00f2b", pop: "#b5157a",
    },
    dark: {
      name: "portal", mode: "dark", dark: true, borderWidth: 2, radius: 0, radiusSm: 2,
      bgA: "#160b24", bgB: "#1a0828", bgC: "#22123a", blob1: "rgba(255,138,31,0.25)", blob2: "rgba(255,79,184,0.3)",
      card: "#22123a", cardPressed: "#2b1747", border: "#7d61a3",
      shadow: "4px 4px 0px #ff4fb8",
      text: "#f6eefc", muted: "#b9a6cf", faint: "rgba(185,166,207,0.6)", sep: "rgba(125,97,163,0.45)", field: "#0d0716",
      accent: "#ff8a1f", accentSoft: "rgba(255,138,31,0.16)", ink: "#ff8a1f", inkText: "#12061c",
      ok: "#4fd29a", warn: "#ffd23f", danger: "#ff6b80", pop: "#ff4fb8",
    },
  },
};

export const THEME_LABEL: Record<ThemeName, string> = { fluento: "Fluento", ember: "Ember", portal: "Portal" };
export const THEME_SWATCH: Record<ThemeName, [string, string]> = { fluento: ["#7563f0", "#ff9ec7"], ember: ["#e8692a", "#ff8a78"], portal: ["#ff8a1f", "#ff4fb8"] };

const KEY = "ideabox.theme";
type Stored = { pref: ThemePref; web: { theme: ThemeName; mode: Mode } };
let state: Stored = { pref: { theme: "web", mode: "web" }, web: { theme: "fluento", mode: "light" } };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const persist = () => SecureStore.setItemAsync(KEY, JSON.stringify(state)).catch(() => null);

const isTheme = (v: unknown): v is ThemeName => v === "fluento" || v === "ember" || v === "portal";
const isMode = (v: unknown): v is Mode => v === "light" || v === "dark";

/** App 一打開先讀上次的主題（在顯示畫面之前，避免閃一下別的顏色） */
export async function loadTheme() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      state = {
        pref: {
          theme: s.pref?.theme === "web" || isTheme(s.pref?.theme) ? s.pref.theme : "web",
          mode: s.pref?.mode === "web" || s.pref?.mode === "system" || isMode(s.pref?.mode) ? s.pref.mode : "web",
        },
        web: { theme: isTheme(s.web?.theme) ? s.web.theme : "fluento", mode: isMode(s.web?.mode) ? s.web.mode : "light" },
      };
      emit();
    }
  } catch {
    /* 讀不到就用預設 */
  }
}

/** 首頁 API 帶回網頁目前的主題 */
export function setWebTheme(v: { theme?: unknown; mode?: unknown } | undefined) {
  if (!v || !isTheme(v.theme) || !isMode(v.mode)) return;
  if (v.theme === state.web.theme && v.mode === state.web.mode) return;
  state = { ...state, web: { theme: v.theme, mode: v.mode } };
  emit();
  persist();
}

export function setThemePref(p: Partial<ThemePref>) {
  state = { ...state, pref: { ...state.pref, ...p } };
  emit();
  persist();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useThemeState(): Stored {
  return useSyncExternalStore(subscribe, () => state);
}

/** App 只用 Fluento／Ember：網頁選 Portal（或以前存過 Portal）時改用最接近的 Ember */
export const appTheme = (n: ThemeName): ThemeName => (n === "portal" ? "ember" : n);

/** 畫面用：目前的配色 */
export function useTheme(): Palette {
  const { pref, web } = useThemeState();
  const system = useColorScheme();
  const name = appTheme(pref.theme === "web" ? web.theme : pref.theme);
  const mode: Mode = pref.mode === "web" ? web.mode : pref.mode === "system" ? (system === "dark" ? "dark" : "light") : pref.mode;
  return PALETTES[name][mode];
}

/** 依配色產生樣式（配色沒變就不重算） */
export function useStyles<T>(make: (t: Palette) => T): T {
  const t = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => make(t), [t]);
}

/** 專案顏色：跟網頁專案頁、辦公室同一組，照專案排序依序分配 */
export const PROJECT_COLORS = ["#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#ef4444", "#94a3b8"];
