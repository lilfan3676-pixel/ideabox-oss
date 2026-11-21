// 手勢是橫的還是直的（純函式，不 import React Native，網頁那邊的測試也跑得到）。
// 拇指滑左右時軌跡是弧形，常常帶著不少上下的位移；所以偏向判成「橫的」：
// 跟水平夾角 55 度以內都算橫的，明顯是直的（而且動得夠遠）才算直的。
export type Axis = "x" | "y";

/** 還看不出來回傳 null（再等下一個點） */
export function axisOf(dx: number, dy: number): Axis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.hypot(ax, ay) < 8) return null;
  if (ax >= ay * 0.7) return "x";
  return ay >= 14 ? "y" : null;
}

/** 已經當成直的在拉了，結果手指其實是往旁邊走：改回橫的（只在還沒拉遠之前改） */
export function turnedSideways(dx: number, dy: number): boolean {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > 24 && ax > ay * 1.2 && ay < 70;
}
