// 小助手的位置：拖到哪就停在哪，拖到左右邊緣就收起來；記在鑰匙圈，下次打開還在
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/** x、y 是人物左上角佔螢幕寬／高的比例（換手機、轉向也不會跑出畫面）；edge＝收在哪一邊 */
export type AssistantPos = { x: number; y: number; edge: "left" | "right" | null };

const KEY = "ideabox.assistant";
let pos: AssistantPos | null = null; // null＝預設右下角
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// 大小：兩根手指縮放，1＝原本大小
const SCALE_KEY = "ideabox.assistant.scale";
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.8;
let scale = 1;
export const clampScale = (s: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));

export function saveAssistantScale(s: number | null) {
  scale = s == null ? 1 : clampScale(s);
  emit();
  if (s == null) SecureStore.deleteItemAsync(SCALE_KEY).catch(() => null);
  else SecureStore.setItemAsync(SCALE_KEY, String(scale)).catch(() => null);
}

export function useAssistantScale(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => scale,
  );
}

export async function loadAssistantPos() {
  try {
    const rawScale = await SecureStore.getItemAsync(SCALE_KEY);
    const n = rawScale ? Number(rawScale) : NaN;
    if (Number.isFinite(n)) {
      scale = clampScale(n);
      emit();
    }
  } catch {
    /* 讀不到就用原本大小 */
  }
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const p = JSON.parse(raw) as AssistantPos;
      if (typeof p.x === "number" && typeof p.y === "number") {
        pos = { x: p.x, y: p.y, edge: p.edge === "left" || p.edge === "right" ? p.edge : null };
        emit();
      }
    }
  } catch {
    /* 讀不到就用預設 */
  }
}

export function saveAssistantPos(p: AssistantPos | null) {
  pos = p;
  emit();
  if (p) SecureStore.setItemAsync(KEY, JSON.stringify(p)).catch(() => null);
  else SecureStore.deleteItemAsync(KEY).catch(() => null);
}

export function useAssistantPos(): AssistantPos | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pos,
  );
}
