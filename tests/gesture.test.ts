// 手機 App 的手勢判斷：左右滑不要被當成上下
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformWithOxc } from "vite";
import { describe, expect, it } from "vitest";

// 不直接 import：mobile/ 是另一個套件，它的 tsconfig 要先在 mobile/ 裝好套件才讀得到；
// 這個檔是純函式，所以讀原始碼、去掉型別再執行，沒裝 App 的套件也測得到。
type Gesture = typeof import("../mobile/src/lib/gesture");
const src = readFileSync(join(__dirname, "../mobile/src/lib/gesture.ts"), "utf8");
const js = (await transformWithOxc(src, join(__dirname, "gesture.virtual.ts"))).code.replace(/^export /gm, "");
const { axisOf, turnedSideways } = new Function(`${js}\nreturn { axisOf, turnedSideways };`)() as Gesture;

/** 走一條軌跡，回傳第一次判出來的方向（跟 PanResponder 一樣，每個點問一次） */
const first = (path: [number, number][]) => {
  for (const [dx, dy] of path) {
    const a = axisOf(dx, dy);
    if (a) return a;
  }
  return null;
};

describe("手勢方向", () => {
  it("還沒動多少不判斷", () => {
    expect(axisOf(3, 2)).toBeNull();
    expect(axisOf(0, 7)).toBeNull();
  });
  it("拇指往左滑的弧形軌跡（帶著上下位移）算左右", () => {
    // 往左同時往下掉：舊規則（橫的要比直的大 1.5 倍）這條整段都判不出左右
    expect(first([[-3, 2], [-7, 5], [-12, 9], [-20, 15], [-35, 26], [-60, 40]])).toBe("x");
    // 一開始幾乎斜 45 度
    expect(first([[5, 5], [9, 9], [16, 14]])).toBe("x");
    // 稍微偏直（約 50 度）還是算左右
    expect(axisOf(10, 12)).toBe("x");
  });
  it("明顯是直的才算上下，而且要動得夠遠", () => {
    expect(axisOf(2, 10)).toBeNull(); // 直的但才 10 點，再等等
    expect(first([[1, 5], [2, 10], [3, 16], [4, 30]])).toBe("y");
    expect(axisOf(8, -30)).toBe("y");
  });
  it("一開始往上頂一下才往旁邊滑：改回左右；真的在上下拉就不改", () => {
    expect(first([[1, -6], [2, -15]])).toBe("y");
    expect(turnedSideways(-30, -18)).toBe(true);
    expect(turnedSideways(-20, -18)).toBe(false); // 還不夠明顯
    expect(turnedSideways(10, -120)).toBe(false);
    expect(turnedSideways(100, -80)).toBe(false); // 已經拉很遠了，不半路改
  });
});
