// 重點分層用的共用元件（今天頁 A 方案的做法套到每一頁）：
// 每頁一個主角（Hero 大卡／大字），其他清單用 Compact 精簡列，字小一級、次要資訊變淡
import { type ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { useTheme, type Palette } from "@/lib/theme";
import { Dot } from "./ui";

/** hex 色加透明度 */
export function soft(hex: string, a: number) {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  return `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

/** 主角大卡：主色底白字（tone="accent"）或淡色底（tone="soft"） */
export function Hero({
  kicker,
  big,
  title,
  sub,
  chips,
  children,
  onPress,
  tone = "accent",
  color,
  a11y,
}: {
  kicker?: string;
  big?: string | null;
  title: string;
  sub?: string | null;
  chips?: string[];
  children?: ReactNode;
  onPress?: () => void;
  tone?: "accent" | "soft";
  color?: string;
  a11y?: string;
}) {
  const t = useTheme();
  const base = color ?? t.accent;
  const solid = tone === "accent";
  const fg = solid ? "#ffffff" : t.text;
  const style: ViewStyle = {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 22,
    padding: 18,
    paddingBottom: 16,
    backgroundColor: solid ? base : soft(base, 0.12),
    boxShadow: solid ? `0px 10px 28px ${soft(base, 0.32)}` : undefined,
  };
  const body = (
    <>
      {kicker ? <Text style={{ fontSize: 13, fontWeight: "700", color: fg, opacity: solid ? 0.88 : 0.7 }}>{kicker}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: kicker ? 6 : 0, flexWrap: "wrap" }}>
        {big ? <Text style={{ fontSize: 34, fontWeight: "800", color: fg, fontVariant: ["tabular-nums"] }}>{big}</Text> : null}
        <Text style={{ fontSize: big ? 20 : 24, fontWeight: "800", color: fg, flexShrink: 1 }}>{title}</Text>
      </View>
      {sub ? <Text style={{ fontSize: 14, color: fg, opacity: solid ? 0.92 : 0.75, marginTop: 4, lineHeight: 20 }}>{sub}</Text> : null}
      {children}
      {chips?.length ? <Chips chips={chips} color={fg} bg={solid ? "rgba(255,255,255,0.22)" : soft(base, 0.16)} /> : null}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [style, { opacity: pressed ? 0.92 : 1 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={style} accessibilityLabel={a11y}>{body}</View>
  );
}

export function Chips({ chips, color, bg }: { chips: string[]; color: string; bg: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
      {chips.map((c) => (
        <View key={c} style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color }} numberOfLines={1}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

/** 一段分段進度條（階段） */
export function Progress({ total, done, color, track }: { total: number; done: number; color: string; track: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessibilityLabel={`第 ${done} 個階段，共 ${total} 個`}>
      {Array.from({ length: Math.max(1, total) }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < done ? color : track }} />
      ))}
    </View>
  );
}

/** 精簡的一行：左邊時間／日期、中間標題、右邊補充（字小一級，讓主角突出） */
export function Compact({
  t,
  left,
  leftStrong,
  leftColor,
  title,
  titleWeight = "600",
  right,
  dot,
  last,
  onPress,
  leftWidth = 54,
}: {
  t: Palette;
  left: string;
  leftStrong?: boolean;
  leftColor?: string;
  title: string;
  titleWeight?: "500" | "600" | "700";
  right?: string;
  dot?: string;
  last?: boolean;
  onPress?: () => void;
  leftWidth?: number;
}) {
  const row = (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: 46 }}>
      <Text style={{ width: leftWidth, fontSize: 14, fontWeight: leftStrong ? "800" : "500", color: leftColor ?? (leftStrong ? t.text : t.muted), fontVariant: ["tabular-nums"] }}>{left}</Text>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, paddingRight: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.sep }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: titleWeight, color: t.text }} numberOfLines={2}>{title}</Text>
        {right ? <Text style={{ fontSize: 13, color: t.muted, maxWidth: 120 }} numberOfLines={1}>{right}</Text> : null}
        {dot ? <Dot color={dot} size={7} /> : null}
        {onPress ? <Text style={{ fontSize: 20, color: t.faint, marginTop: -2 }}>›</Text> : null}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { backgroundColor: t.cardPressed }}>
      {row}
    </Pressable>
  ) : (
    row
  );
}

/** 大字日期標題：「11/19（四）」＋右邊小標籤 */
export function DayHeading({ t, day, chip }: { t: Palette; day: string; chip?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginHorizontal: 20, marginTop: 22, marginBottom: 8 }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: t.text }}>{day}</Text>
      {chip ? <Text style={{ fontSize: 13, fontWeight: "700", color: t.accent }}>{chip}</Text> : null}
    </View>
  );
}

export type TimelineItem = { key: string; time: string | null; title: string; sub?: string; color: string; milestone?: boolean };

/**
 * 時間軸（月曆選到的那天）：整天的、里程碑在上面，有時間的照時間往下排；
 * 看今天時在現在的位置畫一條主色「現在」線，已經過的變淡
 */
export function Timeline({ t, items, nowHm }: { t: Palette; items: TimelineItem[]; nowHm?: string | null }) {
  const allDay = items.filter((i) => !i.time);
  const timed = items.filter((i) => i.time).sort((a, b) => a.time!.localeCompare(b.time!));
  type Row = { kind: "item"; it: TimelineItem; past: boolean } | { kind: "now" };
  const rows: Row[] = allDay.map((it) => ({ kind: "item" as const, it, past: false }));
  let nowPlaced = !nowHm;
  for (const it of timed) {
    if (!nowPlaced && it.time! > nowHm!) {
      rows.push({ kind: "now" });
      nowPlaced = true;
    }
    rows.push({ kind: "item", it, past: !!nowHm && it.time! <= nowHm });
  }
  if (!nowPlaced && timed.length) rows.push({ kind: "now" });
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        if (r.kind === "now") {
          return (
            <View key="now" style={{ flexDirection: "row", alignItems: "center", height: 26 }} accessibilityLabel={`現在 ${nowHm}`}>
              <Text style={{ width: 66, fontSize: 13, fontWeight: "800", color: t.accent }}>現在</Text>
              <View style={{ width: 16, alignItems: "center" }}><View style={{ width: 14, height: 2, backgroundColor: t.accent }} /></View>
              <View style={{ flex: 1, height: 2, backgroundColor: t.accent, opacity: 0.45, marginLeft: 8 }} />
            </View>
          );
        }
        const { it, past } = r;
        const big = !!it.time;
        return (
          <View key={it.key} style={{ flexDirection: "row", opacity: past ? 0.5 : 1 }}>
            <Text numberOfLines={1} style={{ width: 66, fontSize: big ? 20 : 13, fontWeight: big ? "800" : "600", color: it.milestone ? t.warn : big ? t.accent : t.muted, fontVariant: ["tabular-nums"], paddingTop: big ? 0 : 3 }}>
              {it.time ?? (it.milestone ? "里程碑" : "整天")}
            </Text>
            <View style={{ width: 16, alignItems: "center" }}>
              <View style={{ width: big ? 13 : 10, height: big ? 13 : 10, borderRadius: it.milestone ? 2 : 7, transform: it.milestone ? [{ rotate: "45deg" }] : undefined, backgroundColor: it.color, marginTop: big ? 6 : 5 }} />
              {!last ? <View style={{ flex: 1, width: 2, backgroundColor: t.sep, marginTop: 3 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingLeft: 10, paddingBottom: 16 }}>
              <Text style={{ fontSize: big ? 17 : 15, fontWeight: big ? "800" : "700", color: t.text, lineHeight: big ? 24 : 21 }}>{it.title}</Text>
              {it.sub ? <Text style={{ fontSize: 13, color: t.muted, marginTop: 2 }}>{it.sub}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
