// 外觀：App 2.4「柔和卡片」版（使用者 2026-11-22 選的：Pinterest 參考的圓角卡片版面＋一支 Reel 的配色 2）。
// 配色的做法是「單純的底色＋一個主色＋一個讓人意外的重點色」：午夜黑底、電光藍是主色、橘色只點在最要緊的地方。
// App 固定用這一套深色（使用者選的），不跟手機的淺色／深色，也沒有外觀選項。
export type Palette = {
  dark: boolean;
  bg: string;
  ink: string;
  muted: string;
  /** 卡片的底色（浮在午夜黑上的那一層） */
  card: string;
  /** 卡片裡更淺的一層：標籤、進度條還沒走到的部分 */
  soft: string;
  line: string;
  track: string;
  /** 主色（電光藍）：選到的日子、現在這一頁、「下一件」那張大卡、進度 */
  main: string;
  onMain: string;
  /** 重點色（橘）：只給「下一件」「等你回覆」這種最要緊的標記 */
  acc: string;
  onAcc: string;
  ok: string;
  bad: string;
  badText: string;
  badBg: string;
  /** 小球：黑底上是白球、深色眼睛 */
  ball: string;
  ballBase: string;
  eye: string;
  ballShadow: string | undefined;
  /** 蓋在會捲動的內容上的實心底（導覽列） */
  solid: string;
};

export const NIGHT: Palette = {
  dark: true,
  bg: "#090a0e",
  ink: "#f1f3f8",
  muted: "#8d93a4",
  card: "#16181f",
  soft: "#20232d",
  line: "rgba(255,255,255,0.09)",
  track: "#20232d",
  main: "#2f8cff",
  onMain: "#ffffff",
  acc: "#ff8a3d",
  onAcc: "#1d0d00",
  ok: "#4fd49a",
  bad: "#ff6b6b",
  badText: "#ff7f7f",
  badBg: "rgba(255,107,107,0.16)",
  ball: "radial-gradient(circle at 34% 28%, #ffffff 0%, #e3e6ee 45%, #a3a9ba 100%)",
  ballBase: "#dfe2ea",
  eye: "#10121a",
  ballShadow: "0px 12px 22px rgba(0,0,0,0.5)",
  solid: "#16181f",
};

/** 文字用系統字（中文是蘋方）；數字也是系統字，只是加粗、等寬對齊 */
export const FONT: string | undefined = undefined;

export function useTheme(): Palette {
  return NIGHT;
}

/** 專案顏色：跟網頁專案頁、辦公室同一組，照專案排序依序分配 */
export const PROJECT_COLORS = ["#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#14b8a6", "#22c55e", "#ef4444", "#94a3b8"];
