// 今天頁的背景跟著台北時間換（使用者 2026-11-20 選的「跟著時間變」）：
// 白天深藍到天藍、傍晚暖橘、晚上深空黑（月亮後面一圈冷光＋幾顆星）。早上的金色版本使用者不要，拿掉了
export type SkyKey = "day" | "dusk" | "night";
export type Sky = {
  key: SkyKey;
  label: string;
  /** 整面背景（底部一團光＋左右暗角＋由上到下的漸層） */
  bg: string;
  /** 漸層還沒畫出來時的底色 */
  base: string;
  /** 往上拉的清單、左下角按鈕的深色底 */
  panel: string;
  /** 白色膠囊上的字、時間軸上「還沒到」的點的填色 */
  ink: string;
  dot: string;
  stars: boolean;
};

const make = (key: SkyKey, label: string, stops: [string, string, string, string, string], glow: string, panel: string, ink: string, dot: string, stars = false): Sky => ({
  key,
  label,
  bg: `radial-gradient(90% 42% at 50% 104%, ${glow} 0%, rgba(0,0,0,0) 72%), linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0) 74%, rgba(0,0,0,0.7) 100%), linear-gradient(180deg, ${stops[0]} 0%, ${stops[1]} 22%, ${stops[2]} 50%, ${stops[3]} 78%, ${stops[4]} 100%)`,
  base: stops[1],
  panel,
  ink,
  dot,
  stars,
});

export const SKIES: Record<SkyKey, Sky> = {
  day: make("day", "白天", ["#020a14", "#07192e", "#0f3a63", "#1f6090", "#3d86b3"], "#8fd0f0", "rgba(3,14,26,0.66)", "#07192e", "#17507c"),
  dusk: make("dusk", "傍晚", ["#0c0504", "#1e0d09", "#4a2014", "#8a4a2c", "#b9703f"], "#e89a62", "rgba(24,10,7,0.66)", "#2e140e", "#7a4a34"),
  // 深空黑：跟其他頁一樣的純黑，只在月亮後面有一圈冷光
  night: {
    key: "night",
    label: "晚上",
    bg: "radial-gradient(62% 36% at 50% 40%, rgba(120,140,190,0.30) 0%, rgba(120,140,190,0) 70%)",
    base: "#000000",
    panel: "rgba(16,16,20,0.9)",
    ink: "#000000",
    dot: "#1c1c1e",
    stars: true,
  },
};

/** 05:00～16:00 白天、16:00～19:00 傍晚、其他是晚上 */
export function skyKeyAt(hm: string): SkyKey {
  const m = +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
  if (m >= 300 && m < 960) return "day";
  if (m >= 960 && m < 1140) return "dusk";
  return "night";
}

/** 夜空的星星：位置是螢幕寬高的比例（固定的，不會每次重排） */
export const STARS: [number, number, number][] = [
  [0.12, 0.09, 0.7], [0.82, 0.13, 0.5], [0.64, 0.06, 0.8], [0.3, 0.19, 0.4], [0.9, 0.33, 0.6], [0.07, 0.43, 0.5],
  [0.74, 0.5, 0.35], [0.2, 0.58, 0.5], [0.5, 0.11, 0.4], [0.93, 0.07, 0.6], [0.4, 0.04, 0.5], [0.16, 0.3, 0.45],
];
