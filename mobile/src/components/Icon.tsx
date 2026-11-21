// 圖示：同一套細線（1.5 粗、圓頭），顏色跟著字，不另外上色
import Svg, { Circle, Path, Rect } from "react-native-svg";

type Shape = ["p", string] | ["f", string] | ["c", number, number, number] | ["r", number, number, number, number, number];

const ICONS = {
  sun: [["c", 12, 12, 4], ["p", "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"]],
  calendar: [["r", 3, 4, 18, 18, 2], ["p", "M16 2v4M8 2v4M3 10h18"]],
  folder: [["p", "M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]],
  activity: [["p", "M22 12h-4l-3 9L9 3l-3 9H2"]],
  users: [["c", 9, 8, 4], ["p", "M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"], ["p", "M16 4.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7"]],
  sliders: [["p", "M4 8h10M18 8h2M4 16h2M10 16h10"], ["c", 16, 8, 2], ["c", 8, 16, 2]],
  clock: [["c", 12, 12, 9], ["p", "M12 7v5l3 2"]],
  flag: [["p", "M5 21V4M5 4h13l-2.5 4 2.5 4H5"]],
  check: [["c", 12, 12, 9], ["p", "m8 12 3 3 5-6"]],
  tasks: [["p", "M11 6h10M11 12h10M11 18h10M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"]],
  bell: [["p", "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 8H4c0-1 2-2 2-8M10 21h4"]],
  globe: [["c", 12, 12, 9], ["p", "M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"]],
  contrast: [["c", 12, 12, 9], ["f", "M12 3a9 9 0 0 1 0 18z"]],
  link: [["p", "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"]],
  unlink: [["p", "M13 6l1-1a4 4 0 0 1 5.7 5.7l-1 1M11 18l-1 1a4 4 0 0 1-5.7-5.7l1-1M4 4l16 16"]],
  bulb: [["p", "M9 18h6M10 21h4M8 14a6 6 0 1 1 8 0c-.7.7-1 1.4-1 2H9c0-.6-.3-1.3-1-2z"]],
  note: [["p", "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"]],
  chev: [["p", "m9 6 6 6-6 6"]],
  back: [["p", "m15 6-6 6 6 6"]],
  wait: [["p", "M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"]],
  warn: [["p", "M12 4 2.5 20h19zM12 10v4M12 17h.01"]],
  phone: [["r", 7, 2, 10, 20, 2], ["p", "M11 18h2"]],
  moon: [["p", "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"]],
  at: [["c", 12, 12, 4], ["p", "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"]],
  chat: [["p", "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z"]],
  close: [["p", "M5 5l14 14M19 5 5 19"]],
  scan: [["p", "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"]],
  grid: [["c", 6, 6, 3.2], ["c", 18, 6, 3.2], ["c", 6, 18, 3.2], ["c", 18, 18, 3.2]],
  key: [["c", 8, 15, 4], ["p", "M11 12l9-9M16 7l3 3M14 9l2 2"]],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

/** label 有給＝這個圖示自己有意思（旁邊沒有字）；沒給＝純裝飾，讀螢幕時跳過 */
export function Icon({ name, size = 18, color, label }: { name: IconName; size?: number; color: string; label?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label} importantForAccessibility={label ? "yes" : "no-hide-descendants"} accessibilityElementsHidden={!label}>
      {(ICONS[name] as Shape[]).map((s, i) =>
        s[0] === "p" ? <Path key={i} d={s[1]} /> : s[0] === "f" ? <Path key={i} d={s[1]} fill={color} /> : s[0] === "c" ? <Circle key={i} cx={s[1]} cy={s[2]} r={s[3]} /> : <Rect key={i} x={s[1]} y={s[2]} width={s[3]} height={s[4]} rx={s[5]} />,
      )}
    </Svg>
  );
}
