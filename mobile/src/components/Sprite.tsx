// 小助手的分格動畫。公開版沒有附角色圖，所以什麼都不顯示；
// 想加自己的角色：把橫排的分格圖放進 assets/assistant/，照下面的名字用寫死的 require 載入、用 Image 一格一格播。
import type { ViewStyle } from "react-native";

export type AnimName = "idle" | "run-right" | "run-left" | "wave" | "ready" | "nod" | "shrug" | "think" | "ponder" | "look-around" | "look-up";

export function Sprite(_props: { anim: AnimName; height?: number; loop?: boolean; onEnd?: () => void; style?: ViewStyle }) {
  return null;
}
