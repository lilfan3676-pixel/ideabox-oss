// 共用畫面元件：跟 ideabox 網頁同一套主題（漸層背景＋半透明卡片；Portal 是直角粗框＋硬陰影）
import { type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { PROJECT_COLORS, useStyles, useTheme, type Palette } from "@/lib/theme";

/** 每個專案一個顏色：照 ideabox 的專案排序依序分配（跟網頁一樣）；還不知道排序時才用 id 算 */
const order = new Map<string, number>();
export function rememberProjectOrder(ids: string[]) {
  ids.forEach((id, i) => order.set(id, i));
}
/** 專案在 ideabox 排序裡是第幾個（光環磚的顏色用；還不知道排序時用 id 算一個固定的數） */
export function projectIndex(id: string): number {
  const i = order.get(id);
  if (i !== undefined) return i;
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 6;
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

/** 網頁的背景：三段斜向漸層＋左上、右下兩團光暈（疊成一個背景，不會跟著內容捲動） */
export const backdropImage = (t: Palette) =>
  `radial-gradient(circle at 8% 12%, ${t.blob1} 0%, transparent 45%), radial-gradient(circle at 95% 88%, ${t.blob2} 0%, transparent 50%), linear-gradient(160deg, ${t.bgA} 0%, ${t.bgB} 45%, ${t.bgC} 100%)`;

export function Backdrop() {
  const t = useTheme();
  return <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: backdropImage(t) }]} pointerEvents="none" />;
}

// ScrollView 一定要是畫面的第一層，iOS 的大標題才會跟著捲動縮小、標題列才會透明
export function Screen({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bgA, experimental_backgroundImage: backdropImage(t) }}
      contentInsetAdjustmentBehavior="automatic"
      // 底部留位置給懸浮的三顆按鈕
      contentContainerStyle={{ paddingBottom: 130 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

/** 卡片外框（網頁的 .glass） */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useStyles(make);
  return <View style={[s.card, style]}>{children}</View>;
}

export function Section({ title, footer, children, right }: { title?: string; footer?: string; children: ReactNode; right?: ReactNode }) {
  const s = useStyles(make);
  return (
    <View style={s.section}>
      {(title || right) && (
        <View style={s.sectionHead}>
          {title ? <Text style={s.sectionTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      <View style={s.card}>{children}</View>
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  left,
  right,
  onPress,
  last,
  multiline,
  destructive,
}: {
  destructive?: boolean;
  title: string;
  subtitle?: string | null;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  multiline?: boolean;
}) {
  const t = useTheme();
  const s = useStyles(make);
  const body = (
    <View style={s.row}>
      {left ? <View style={s.rowLeft}>{left}</View> : null}
      <View style={[s.rowMain, !last && s.rowSep]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.rowTitle, destructive && { color: t.danger }]} numberOfLines={multiline ? undefined : 2}>{title}</Text>
          {subtitle ? <Text style={s.rowSub} numberOfLines={multiline ? undefined : 2}>{subtitle}</Text> : null}
        </View>
        {right}
        {onPress && !destructive ? <Text style={s.chevron}>›</Text> : null}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: t.cardPressed }} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Pill({ text, color, style }: { text: string; color?: string; style?: ViewStyle }) {
  const t = useTheme();
  const s = useStyles(make);
  return (
    <View style={[s.pill, style]}>
      <Text style={[s.pillText, { color: color ?? t.muted }]}>{text}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const s = useStyles(make);
  return <Text style={s.empty}>{text}</Text>;
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bgA }}>
      <ActivityIndicator color="#ffffff" />
      <Text style={{ color: t.muted, fontSize: 15, marginTop: 12 }}>讀取中…</Text>
    </View>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const t = useTheme();
  const s = useStyles(make);
  return (
    <View style={[s.card, s.error]}>
      <Text style={{ color: t.danger, fontSize: 15, flex: 1 }}>{text}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={10}>
          <Text style={{ color: t.accent, fontSize: 15, fontWeight: "600" }}>重試</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 各分頁的標題列：透明、底下透出漸層背景，字和返回鍵跟著主題色 */
export function useStackOptions() {
  const t = useTheme();
  return {
    headerLargeTitle: true,
    headerTransparent: true,
    headerStyle: { backgroundColor: "transparent" },
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerBackTitle: "返回",
    headerTintColor: t.accent,
    headerTitleStyle: { color: t.text },
    headerLargeTitleStyle: { color: t.text, fontWeight: "800" as const },
    contentStyle: { backgroundColor: t.bgA },
  };
}

export const make = (t: Palette) =>
  StyleSheet.create({
    section: { marginTop: 22, marginHorizontal: 16 },
    sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8, paddingHorizontal: 4 },
    sectionTitle:
      t.name === "portal"
        ? { fontSize: 14, color: t.pop, fontWeight: "900", letterSpacing: 0.6 }
        : { fontSize: 13, color: t.muted, fontWeight: "600", letterSpacing: 0.2 },
    footer: { fontSize: 13, color: t.muted, marginTop: 8, paddingHorizontal: 4, lineHeight: 18 },
    card: {
      backgroundColor: t.card,
      borderRadius: t.radius,
      borderWidth: t.borderWidth,
      borderColor: t.border,
      boxShadow: t.shadow,
      overflow: t.name === "portal" ? "visible" : "hidden",
    },
    row: { flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: 50 },
    rowLeft: { marginRight: 12, alignItems: "center", justifyContent: "center", minWidth: 10 },
    rowMain: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingRight: 14, gap: 10 },
    rowSep: { borderBottomWidth: t.name === "portal" ? 1 : StyleSheet.hairlineWidth, borderBottomColor: t.sep },
    rowTitle: { fontSize: 16, color: t.text, fontWeight: "600" },
    rowSub: { fontSize: 14, color: t.muted, marginTop: 2, lineHeight: 19 },
    chevron: { fontSize: 22, color: t.faint, marginLeft: 2, marginTop: -2 },
    pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: t.radiusSm, backgroundColor: t.accentSoft },
    pillText: { fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },
    empty: { fontSize: 15, color: t.muted, padding: 16 },
    error: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 16, padding: 14 },
  });
