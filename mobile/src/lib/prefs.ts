// 這支手機自己的偏好：語言、深淺色。存在鑰匙圈旁邊（SecureStore），不跟網頁同步
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

export type Prefs = { lang: "system" | "zh" | "en"; look: "system" | "light" | "dark" };

const KEY = "ideabox.prefs";
let current: Prefs = { lang: "system", look: "system" };
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
