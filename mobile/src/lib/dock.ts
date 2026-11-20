// 底部懸浮列跟各畫面之間的小橋：重新整理、今天頁的清單開合
import { useSyncExternalStore } from "react";

type L = () => void;

const refreshers = new Set<L>();
/** 畫面掛上自己的重新整理；回傳的函式用來取消 */
export function onDockRefresh(l: L) {
  refreshers.add(l);
  return () => {
    refreshers.delete(l);
  };
}
export const dockRefresh = () => refreshers.forEach((l) => l());

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
