// 配對資訊（ideabox 網址＋這台手機的登入憑證）存在 iOS 鑰匙圈
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/** tabs：這支手機看得到的分頁（合夥人的手機只有部分；舊的配對沒有＝全部） */
export type Session = { server: string; token: string; tabs?: string[] };

const KEY = "ideabox.session";
let current: Session | null | undefined; // undefined = 還沒從鑰匙圈讀出來
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadSession(): Promise<Session | null> {
  if (current !== undefined) return current;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  emit();
  return current;
}

export async function saveSession(s: Session | null) {
  current = s;
  if (s) await SecureStore.setItemAsync(KEY, JSON.stringify(s));
  else await SecureStore.deleteItemAsync(KEY);
  emit();
}

export function getSession(): Session | null | undefined {
  return current;
}

/** 畫面用：配對狀態改變時重新繪製（undefined＝讀取中） */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** 「my-ideabox.vercel.app」「https://x.com/」→「https://x.com」 */
export function cleanServer(s: string): string {
  let v = s.trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//i.test(v)) v = `${/^(localhost|127\.|192\.168\.)/.test(v) ? "http" : "https"}://${v}`;
  return v;
}
