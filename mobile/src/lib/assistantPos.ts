// 小助手的位置：拖到哪就停在哪，拖到左右邊緣就收起來；記在鑰匙圈，下次打開還在
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

/** x、y 是人物左上角佔螢幕寬／高的比例（換手機、轉向也不會跑出畫面）；edge＝收在哪一邊 */
export type AssistantPos = { x: number; y: number; edge: "left" | "right" | null };

const KEY = "ideabox.assistant";
let pos: AssistantPos | null = null; // null＝預設右下角
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export async function loadAssistantPos() {
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
