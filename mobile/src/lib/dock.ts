// 底部懸浮列跟今天頁之間的小橋：清單開合
import { useSyncExternalStore } from "react";

type L = () => void;

// 今天頁「往上拉看全部」的清單開著沒
let sheet = false;
const sheetListeners = new Set<L>();
export function setSheet(open: boolean) {
  if (sheet === open) return;
  sheet = open;
  sheetListeners.forEach((l) => l());
}
export const toggleSheet = () => setSheet(!sheet);
export function useSheet(): boolean {
  return useSyncExternalStore(
    (l) => {
      sheetListeners.add(l);
      return () => sheetListeners.delete(l);
    },
    () => sheet,
  );
}
