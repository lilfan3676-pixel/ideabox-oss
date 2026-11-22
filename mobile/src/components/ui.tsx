// 共用畫面元件（2.4 柔和卡片版）：午夜黑底、圓角卡片一張一張浮在上面；
// 主色（電光藍）給「選到的／現在的」，重點色（橘）只給最要緊的標記
import { router } from "expo-router";
import { type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";
import { L } from "@/lib/i18n";
import { useRise } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { FONT, PROJECT_COLORS, useTheme } from "@/lib/theme";
import { Icon, type IconName } from "./Icon";

/** 每個專案一個顏色：照 ideabox 的專案排序依序分配（跟網頁一樣）；還不知道排序時才用 id 算 */
const order = new Map<string, number>();
export function rememberProjectOrder(ids: string[]) {
  ids.forEach((id, i) => order.set(id, i));
}
export function projectColor(id: string): string {
  let i = order.get(id);
  if (i === undefined) {
    let h = 2166136261;
    for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    i = h;
  }
  return PROJECT_COLORS[i % PROJECT_COLORS.length];
}

/** 所有的字：系統字。size 沒給＝15；num＝數字、時間（加粗、等寬對齊）；med＝稍微加粗 */
export function Txt({ size = 15, lh, color, muted, tab, num, med, style, ...rest }: TextProps & { size?: number; lh?: number; color?: string; muted?: boolean; tab?: boolean; num?: boolean; med?: boolean; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text {...rest} style={[{ fontFamily: FONT, fontSize: size, lineHeight: lh ?? Math.round(size * 1.4), color: color ?? (muted ? t.muted : t.ink) }, num ? { fontWeight: "600" } : med ? { fontWeight: "500" } : null, (tab || num) && { fontVariant: ["tabular-nums"] }, style]} />;
}

/** 每頁的標題字 */
export function Big({ children, lines = 1, size = 30, style }: { children: ReactNode; lines?: number; size?: number; style?: StyleProp<TextStyle> }) {
  return <Txt accessibilityRole="header" med size={size} lh={Math.round(size * 1.2)} numberOfLines={lines} adjustsFontSizeToFit minimumFontScale={0.7} style={style}>{children}</Txt>;
}

/** 圓形的圖示鈕（返回、設定、連結） */
export function RoundButton({ icon, label, onPress, size = 42 }: { icon: IconName; label: string; onPress: () => void; size?: number }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={size < 44 ? (44 - size) / 2 : 0} style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: t.card, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={t.ink} />
    </Pressable>
  );
}

/** 頁面最上面：小字的現況＋大字的頁名；右邊可以放一顆膠囊，最右邊固定是設定的圖示（設定不在導覽列裡） */
export function Head({ title, sub, right, gear = true }: { title: string; sub?: string; right?: ReactNode; gear?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        {sub ? <Txt size={13.5} lh={19} muted numberOfLines={1}>{sub}</Txt> : null}
        <Big>{title}</Big>
      </View>
      {right}
      {gear ? <RoundButton icon="sliders" label={L("設定", "Settings")} onPress={() => router.navigate("/settings")} /> : null}
    </View>
  );
}

/** 一般頁面：整頁可捲、往下拉重新整理；底部留位置給懸浮的導覽列 */
export function Page({ children, refreshing, onRefresh, swiping }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; /** 正在左右滑（useSwipe 的 dragging）：先把上下捲鎖住 */ swiping?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  usePrefs(); // 切換語言時重畫
  const rise = useRise(); // 第一次出現時淡入、往上浮一點（切回來不重播）
  return (
    <ScrollView
      scrollEnabled={!swiping}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: insets.bottom + 130 }}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}
    >
      <Animated.View style={rise}>{children}</Animated.View>
    </ScrollView>
  );
}

/** 圓角卡片。tone＝main 是整張主色（「下一件」「下一步」那種最重要的一張） */
export function Card({ children, onPress, style, label, tone, top = 10 }: { children: ReactNode; onPress?: () => void; style?: ViewStyle; label?: string; tone?: "main"; top?: number }) {
  const t = useTheme();
  const s: ViewStyle = { marginTop: top, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 22, backgroundColor: tone === "main" ? t.main : t.card, ...style };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s, pressed && { opacity: 0.7 }]}>{children}</Pressable> : <View style={s}>{children}</View>;
}

/** 小膠囊標籤。main＝主色實心、acc＝重點色實心（一頁最多一兩個）、bad＝過期 */
export function Tag({ children, tone, big }: { children: ReactNode; tone?: "main" | "acc" | "bad"; big?: boolean }) {
  const t = useTheme();
  const bg = tone === "main" ? t.main : tone === "acc" ? t.acc : tone === "bad" ? t.badBg : t.soft;
  const fg = tone === "main" ? t.onMain : tone === "acc" ? t.onAcc : tone === "bad" ? t.badText : t.muted;
  return (
    <View style={{ alignSelf: "flex-start", paddingVertical: big ? 8 : 3, paddingHorizontal: big ? 13 : 10, borderRadius: 99, backgroundColor: bg }}>
      <Txt size={big ? 13 : 12} lh={big ? 18 : 17} color={fg} tab numberOfLines={1}>{children}</Txt>
    </View>
  );
}

/** 區塊標題：左邊標題、右邊一句小字或一顆標籤 */
export function Sec({ children, right, top = 20 }: { children: ReactNode; right?: ReactNode; top?: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: top, marginBottom: -2, marginHorizontal: 2 }}>
      <Txt size={16} lh={22} med accessibilityRole="header">{children}</Txt>
      {typeof right === "string" ? <Txt size={13.5} lh={19} muted tab>{right}</Txt> : right}
    </View>
  );
}

/** 卡片裡的一列（列跟列之間一條很淡的線） */
export function Line({ children, first, onPress, label, style }: { children: ReactNode; first?: boolean; onPress?: () => void; label?: string; style?: ViewStyle }) {
  const t = useTheme();
  const s: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: t.line, ...style };
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s, pressed && { opacity: 0.55 }]}>{children}</Pressable>
  ) : (
    <View style={s} accessible={!!label} accessibilityLabel={label}>{children}</View>
  );
}

/** 時間在左、卡片在右的一列（今天、月曆的時間軸） */
export function TimeRow({ time, sub, children, past }: { time: string; sub?: string; children: ReactNode; past?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 10, opacity: past ? 0.5 : 1 }}>
      <View style={{ width: 54, paddingTop: 14 }}>
        <Txt num size={15} lh={20}>{time}</Txt>
        {sub ? <Txt size={11} lh={15} muted>{sub}</Txt> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** 進度條：一條圓頭的線，frac 是 0～1 */
export function Progress({ frac, color, track, top = 6 }: { frac: number; color?: string; track?: string; top?: number }) {
  const t = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(Math.min(1, Math.max(0, frac)) * 100) }} style={{ height: 5, borderRadius: 3, backgroundColor: track ?? t.soft, marginTop: top, overflow: "hidden" }}>
      <View style={{ width: `${Math.min(1, Math.max(0, frac)) * 100}%`, height: 5, borderRadius: 3, backgroundColor: color ?? t.main }} />
    </View>
  );
}

/** 三個數字一排，一個數字一塊圓角小格 */
export function Stat({ items, top = 10 }: { items: { v: ReactNode; label: string; color?: string; onPress?: () => void }[]; top?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: top }}>
      {items.map((it, i) => {
        const body = (
          <>
            <Txt num size={24} lh={29} color={it.color} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{it.v}</Txt>
            <Txt size={11.5} lh={16} muted numberOfLines={1}>{it.label}</Txt>
          </>
        );
        const s: ViewStyle = { flex: 1, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 18, backgroundColor: t.card };
        const a11y = `${it.label} ${typeof it.v === "string" || typeof it.v === "number" ? it.v : ""}`;
        return it.onPress ? (
          <Pressable key={i} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [s, pressed && { opacity: 0.55 }]}>{body}</Pressable>
        ) : (
          <View key={i} accessible accessibilityLabel={a11y} style={s}>{body}</View>
        );
      })}
    </View>
  );
}

/** 趨勢線：一串數字畫成一條線（少於兩個點不畫） */
export function Spark({ data, w = 120, h = 40, color, sw = 2 }: { data: number[]; w?: number; h?: number; color?: string; sw?: number }) {
  const t = useTheme();
  if (data.length < 2) return <View style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((v - min) / range) * (h - 8)).toFixed(1)}`).join(" ");
  return (
    <Svg width={w} height={h} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Polyline points={pts} fill="none" stroke={color ?? t.main} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** 幾個選項排成一條膠囊形的分段鈕，選到的那格是主色的實心膠囊 */
export function Segment<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", marginTop: 10, padding: 4, gap: 4, borderRadius: 26, backgroundColor: t.card }} accessibilityRole="radiogroup">
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onPick(v)} accessibilityRole="radio" accessibilityState={{ selected: on }} style={{ flex: 1, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: on ? t.main : "transparent" }}>
            <Txt size={14} lh={20} color={on ? t.onMain : t.muted}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Txt size={14} muted style={{ paddingVertical: 14 }}>{text}</Txt>;
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
      <ActivityIndicator color={t.muted} />
    </View>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 }}>
      <Icon name="warn" size={16} color={t.badText} />
      <Txt size={14} color={t.badText} style={{ flex: 1 }}>{text}</Txt>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={12} accessibilityRole="button">
          <Txt size={14} style={{ textDecorationLine: "underline" }}>{L("重試", "Retry")}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}
