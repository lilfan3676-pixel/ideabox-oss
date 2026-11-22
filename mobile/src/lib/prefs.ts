// 這支手機自己的偏好：語言、小球（要不要顯示、大小、放在哪）。存在鑰匙圈旁邊（SecureStore），不跟網頁同步。
// look（深淺色）是 2.3 以前的設定，2.4 起 App 固定深色，欄位留著只是不讓舊資料出錯。
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

export type Prefs = { lang: "system" | "zh" | "en"; look: "system" | "light" | "dark"; orb: boolean; orbSize: "s" | "m" | "l"; /** 小球停在哪一邊、離螢幕上緣多遠（佔螢幕高度的比例） */ orbSide: "left" | "right"; orbY: number };

const KEY = "ideabox.prefs";
let current: Prefs = { lang: "system", look: "system", orb: true, orbSize: "m", orbSide: "right", orbY: 0.74 };
const listeners = new Set<() => void>();

export async function loadPrefs() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) current = { ...current, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // 讀不到就用預設（跟手機）
  }
  listeners.forEach((l) => l());
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
  SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => null);
}

export const getPrefs = () => current;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
