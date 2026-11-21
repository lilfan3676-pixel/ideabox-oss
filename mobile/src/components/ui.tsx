// 共用畫面元件（黑白版）：圓體細字、靠左、一頁一個大字，清單是細線分隔的列，不用白卡片堆疊
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { L } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { balance } from "@/lib/wrap";
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

/** 所有的字：圓體、不加粗。size 沒給＝16 */
export function Txt({ size = 16, lh, color, muted, tab, style, ...rest }: TextProps & { size?: number; lh?: number; color?: string; muted?: boolean; tab?: boolean; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Text {...rest} style={[{ fontFamily: FONT, fontSize: size, lineHeight: lh ?? Math.round(size * 1.4), color: color ?? (muted ? t.muted : t.ink) }, tab && { fontVariant: ["tabular-nums"] }, style]} />;
}

/** 每頁唯一的大字：長體（壓窄到 88%），靠左。
 *  壓窄以後字只佔原本寬度的 88%，所以排版的寬度要放大回來，右邊才不會空一截就換行；
 *  要排兩行時用 balance 自己挑斷點，兩行差不多長、不留孤字。 */
const SLIM = 0.88;
export function Big({ children, lines = 2, size = 40, fit = true, style }: { children: ReactNode; lines?: number; size?: number; fit?: boolean; style?: StyleProp<TextStyle> }) {
  const [w, setW] = useState(0);
  const text = typeof children === "string" && w > 0 && lines > 1 ? balance(children, w / SLIM / size - 0.2) : children;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Txt accessibilityRole="header" size={size} lh={Math.round(size * 1.2)} numberOfLines={lines} adjustsFontSizeToFit={fit} minimumFontScale={0.7} style={[{ width: `${100 / SLIM}%`, transform: [{ scaleX: SLIM }], transformOrigin: "left center" }, style]}>
        {text}
      </Txt>
    </View>
  );
}

/** 頁面最上面那一行：左邊頁名、右邊一句現況 */
export function Head({ title, right, pad }: { title: ReactNode; right?: ReactNode; pad?: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 20 }}>
      {typeof title === "string" ? <Txt size={14} lh={20}>{title}</Txt> : title}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginRight: pad ?? 0 }}>{right}</View>
    </View>
  );
}

/** 一般頁面：整頁可捲、往下拉重新整理；底部留位置給左下角的選單鈕 */
export function Page({ children, refreshing, onRefresh, top = 12, swiping }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; top?: number; /** 正在左右滑（useSwipe 的 dragging）：先把上下捲鎖住，不然手指稍微斜一點整頁就跟著上下跑 */ swiping?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  usePrefs(); // 切換語言時重畫
  return (
    <ScrollView
      scrollEnabled={!swiping}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + top, paddingHorizontal: 28, paddingBottom: insets.bottom + 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** 小標：灰色小字，前面可以放一個圖示 */
export function Label({ children, icon, top = 24 }: { children: ReactNode; icon?: IconName; top?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: top, marginBottom: 4 }}>
      {icon ? <Icon name={icon} size={16} color={t.muted} /> : null}
      <Txt size={14} lh={20} muted accessibilityRole="header">{children}</Txt>
    </View>
  );
}

/** 清單的一列：細線分隔 */
export function Line({ children, last, onPress, h = 52, label, style }: { children: ReactNode; last?: boolean; onPress?: () => void; h?: number; label?: string; style?: ViewStyle }) {
  const t = useTheme();
  const s: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 12, minHeight: h, paddingVertical: 8, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line, ...style };
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s, pressed && { opacity: 0.55 }]}>{children}</Pressable>
  ) : (
    <View style={s} accessible={!!label} accessibilityLabel={label}>{children}</View>
  );
}

/** 列左邊的時間／日期欄 */
export function TimeCell({ children, strong, w = 48 }: { children: ReactNode; strong?: boolean; w?: number }) {
  return <Txt size={14} lh={20} muted={!strong} tab style={{ width: w }}>{children}</Txt>;
}

/** 列右邊的小字（可以帶圖示） */
export function Small({ children, color, icon, iconLabel }: { children?: ReactNode; color?: string; icon?: IconName; iconLabel?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {icon ? <Icon name={icon} size={14} color={color ?? t.muted} label={iconLabel} /> : null}
      {children != null ? <Txt size={13} lh={18} color={color ?? t.muted} tab numberOfLines={1}>{children}</Txt> : null}
    </View>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** 「現在這個」的記號：兩條小眼睛 */
export function Sig({ label, w = 3, h = 10 }: { label: string; w?: number; h?: number }) {
  const t = useTheme();
  const bar = { width: w, height: h, borderRadius: 2, backgroundColor: t.ink };
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: "row", gap: w, transform: [{ rotate: "-8deg" }] }}>
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/** 階段進度：幾段細線 */
export function Bars({ done, total, w = 200 }: { done: number; total: number; w?: number }) {
  const t = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={L(`第 ${done} 階段，共 ${total} 階段`, `Stage ${done} of ${total}`)} style={{ flexDirection: "row", gap: 4, width: w, marginTop: 12 }}>
      {Array.from({ length: Math.max(1, total) }, (_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < done ? t.ink : t.track }} />)}
    </View>
  );
}

/** 淡灰底細框的卡片（一頁最多一張） */
export function Box({ children, onPress, style, label }: { children: ReactNode; onPress?: () => void; style?: ViewStyle; label?: string }) {
  const t = useTheme();
  const s: ViewStyle = { padding: 16, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, ...style };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s, pressed && { opacity: 0.6 }]}>{children}</Pressable> : <View style={s}>{children}</View>;
}

/** 圓形小鈕（返回、連結、選單） */
export function RoundButton({ icon, label, onPress, size = 40, solid }: { icon: IconName; label: string; onPress: () => void; size?: number; solid?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={size < 44 ? (44 - size) / 2 : 0} style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: solid ? t.solid : t.card, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={Math.round(size * 0.42)} color={t.ink} />
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return <Txt size={14} muted style={{ paddingVertical: 16 }}>{text}</Txt>;
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
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
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
