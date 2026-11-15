import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Compact, DayHeading } from "@/components/blocks";
import { Card, Empty, ErrorNote, projectColor, Screen } from "@/components/ui";
import { useStyles, useTheme, type Palette } from "@/lib/theme";
import { addDays, md, taipeiToday } from "@/lib/format";
import type { CalendarData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function CalendarScreen() {
  const t = useTheme();
  const st = useStyles(make);
  const today = taipeiToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const { data, error, refreshing, refresh } = useApi<CalendarData>(`/api/app/calendar?month=${month}`);

  // 月曆格子：從這個月 1 號那週的星期一開始，排滿整週
  const cells = useMemo(() => {
    const first = `${month}-01`;
    const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
    const start = addDays(first, -dow);
    const lastDay = addDays(shiftMonth(month, 1) + "-01", -1);
    const weeks = Math.ceil((dow + +lastDay.slice(8, 10)) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  }, [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>(); // 日期 → 專案 id（畫小點）
    for (const e of data?.events ?? []) {
      for (let d = e.start_date; d <= e.end_date; d = addDays(d, 1)) m.set(d, [...(m.get(d) ?? []), e.project_id]);
    }
    for (const ms of data?.milestones ?? []) m.set(ms.due, [...(m.get(ms.due) ?? []), ms.project_id]);
    return m;
  }, [data]);

  const name = new Map((data?.projects ?? []).map((p) => [p.id, p.name]));
  const dayEvents = (data?.events ?? []).filter((e) => e.start_date <= selected && e.end_date >= selected).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  const dayMs = (data?.milestones ?? []).filter((m) => m.due === selected);

  const go = (n: number) => {
    const next = shiftMonth(month, n);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
    Haptics.selectionAsync();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      <Card style={st.cal}>
        <View style={st.head}>
          <Text style={st.month}>{`${+month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月`}</Text>
          <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
            {month !== today.slice(0, 7) && (
              <Pressable hitSlop={8} onPress={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>
                <Text style={st.link}>今天</Text>
              </Pressable>
            )}
            <Pressable hitSlop={10} onPress={() => go(-1)} accessibilityLabel="上個月"><Text style={st.arrow}>‹</Text></Pressable>
            <Pressable hitSlop={10} onPress={() => go(1)} accessibilityLabel="下個月"><Text style={st.arrow}>›</Text></Pressable>
          </View>
        </View>
        <View style={st.grid}>
          {WEEK.map((w) => <Text key={w} style={st.wd}>{w}</Text>)}
          {cells.map((d) => {
            const other = d.slice(0, 7) !== month;
            const isSel = d === selected;
            const dots = [...new Set(byDay.get(d) ?? [])].slice(0, 3);
            return (
              <Pressable key={d} style={st.cell} onPress={() => { setSelected(d); if (other) setMonth(d.slice(0, 7)); }} accessibilityLabel={md(d)}>
                <View style={[st.num, isSel && { backgroundColor: d === today ? t.accent : t.ink }]}>
                  <Text style={[st.numText, other && { color: t.faint }, d === today && !isSel && { color: t.accent, fontWeight: "800" }, isSel && { color: d === today ? "#ffffff" : t.inkText, fontWeight: "800" }]}>{+d.slice(8, 10)}</Text>
                </View>
                <View style={st.dots}>{dots.map((p, i) => <View key={i} style={[st.dot, { backgroundColor: projectColor(p) }]} />)}</View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* 選到的那天：大字日期當標題，下面精簡列（時間粗體、里程碑 ◆） */}
      <DayHeading t={t} day={md(selected)} chip={selected === today ? "今天" : dayMs.length + dayEvents.length ? `${dayMs.length + dayEvents.length} 件` : undefined} />
      <Card style={{ marginHorizontal: 16 }}>
        {dayMs.map((m, i) => (
          <Compact key={m.id} t={t} left="里程碑" leftColor={t.warn} leftStrong title={`◆ ${m.title}${m.done ? "（已完成）" : ""}`} right={name.get(m.project_id)} dot={projectColor(m.project_id)} last={i === dayMs.length - 1 && !dayEvents.length} />
        ))}
        {dayEvents.map((e, i) => (
          <Compact
            key={e.id}
            t={t}
            left={e.start_time ?? "整天"}
            leftStrong={!!e.start_time}
            title={e.title + (e.end_date > e.start_date ? `（${md(e.start_date)}～${md(e.end_date)}）` : "")}
            right={name.get(e.project_id)}
            dot={projectColor(e.project_id)}
            last={i === dayEvents.length - 1}
          />
        ))}
        {!dayMs.length && !dayEvents.length ? <Empty text={data ? "這天沒有排程" : "讀取中…"} /> : null}
      </Card>
    </Screen>
  );
}

const make = (t: Palette) => StyleSheet.create({
  cal: { marginHorizontal: 16, marginTop: 8, paddingBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  month: { fontSize: 20, fontWeight: "800", color: t.text },
  arrow: { fontSize: 28, color: t.accent, lineHeight: 30 },
  link: { fontSize: 16, color: t.accent },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6 },
  wd: { width: `${100 / 7}%`, textAlign: "center", fontSize: 12, color: t.muted, paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 4, height: 50 },
  num: { width: 32, height: 32, borderRadius: t.name === "portal" ? 0 : 16, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 17, color: t.text, fontVariant: ["tabular-nums"] },
  dots: { flexDirection: "row", gap: 3, marginTop: 3, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
