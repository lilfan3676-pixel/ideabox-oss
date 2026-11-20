import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { ErrorNote, projectColor, Screen } from "@/components/ui";
import { haloAt, useStyles, useTheme, type Palette } from "@/lib/theme";
import { addDays, md, pastBy, taipeiHm, taipeiToday, weekday } from "@/lib/format";
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

  const nowHm = selected === today ? taipeiHm() : null;
  const rows = [
    ...dayMs.map((m) => ({ key: `m${m.id}`, time: "整天", title: `${m.title}${m.done ? "（已完成）" : ""}`, sub: `${name.get(m.project_id) ?? ""} 里程碑`, color: projectColor(m.project_id), milestone: true, past: false })),
    ...dayEvents.map((e) => ({
      key: e.id,
      time: e.start_time ?? "整天",
      title: e.title,
      sub: [name.get(e.project_id), e.end_date > e.start_date ? `${md(e.start_date)}～${md(e.end_date)}` : null].filter(Boolean).join("・"),
      color: projectColor(e.project_id),
      milestone: false,
      past: !!nowHm && pastBy(e.start_time, nowHm),
    })),
  ];

  const go = (n: number) => {
    const next = shiftMonth(month, n);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
    Haptics.selectionAsync();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      <View style={st.cal}>
        <View style={st.head}>
          <Text style={st.month}>{`${+month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月`}</Text>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            {month !== today.slice(0, 7) && (
              <Pressable hitSlop={8} onPress={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>
                <Text style={st.link}>今天</Text>
              </Pressable>
            )}
            <Pressable hitSlop={6} onPress={() => go(-1)} accessibilityRole="button" accessibilityLabel="上個月" style={st.round}><Text style={st.arrow}>‹</Text></Pressable>
            <Pressable hitSlop={6} onPress={() => go(1)} accessibilityRole="button" accessibilityLabel="下個月" style={st.round}><Text style={st.arrow}>›</Text></Pressable>
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
                <View style={[st.num, isSel && { backgroundColor: t.accent, boxShadow: "0px 0px 22px rgba(230,242,75,0.35)" }]}>
                  <Text style={[st.numText, other && { color: t.faint }, d === today && !isSel && { color: t.accent, fontWeight: "800" }, isSel && { color: "#111111", fontWeight: "800" }]}>{+d.slice(8, 10)}</Text>
                </View>
                <View style={st.dots}>{dots.map((p, i) => <View key={i} style={[st.dot, { backgroundColor: projectColor(p) }]} />)}</View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 選到的那天：一張光環漸層卡，裡面是那天的事（整天與里程碑在上、有時間的照時間排，過了的變淡） */}
      <View style={st.day}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700", color: "#ffffff" }}>{`${+selected.slice(8, 10)} 週${weekday(selected)}`}</Text>
          {selected === today || rows.length ? (
            <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#ffffff", justifyContent: "center" }}>
              <Text style={{ fontSize: 12, fontWeight: "800", color: "#05081c" }}>{[selected === today ? "今天" : null, rows.length ? `${rows.length} 件` : null].filter(Boolean).join("・")}</Text>
            </View>
          ) : null}
        </View>
        {rows.length ? (
          rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: "rgba(255,255,255,0.14)", opacity: r.past ? 0.55 : 1 }}>
              <Text style={{ width: 50, fontSize: 16, fontWeight: "700", color: "#ffffff", fontVariant: ["tabular-nums"] }}>{r.time}</Text>
              <View style={{ width: 9, height: 9, borderRadius: r.milestone ? 1 : 5, backgroundColor: r.color, transform: [{ rotate: r.milestone ? "45deg" : "0deg" }] }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: "#ffffff", lineHeight: 21 }}>{r.title}</Text>
                {r.sub ? <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 1 }}>{r.sub}</Text> : null}
              </View>
            </View>
          ))
        ) : (
          <Text style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", paddingVertical: 16 }}>{data ? "這天沒有排程" : "讀取中…"}</Text>
        )}
      </View>
    </Screen>
  );
}

const make = (t: Palette) => StyleSheet.create({
  cal: { marginHorizontal: 10, marginTop: 0, paddingBottom: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 12 },
  month: { fontSize: 27, fontWeight: "700", color: t.muted },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "#0c0c0d", alignItems: "center", justifyContent: "center" },
  arrow: { fontSize: 22, color: "#ffffff", lineHeight: 24, marginTop: -2 },
  link: { fontSize: 15, fontWeight: "700", color: t.accent, marginRight: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  wd: { width: `${100 / 7}%`, textAlign: "center", fontSize: 12, color: t.muted, paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 4, height: 52 },
  num: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: 16, fontWeight: "500", color: t.text, fontVariant: ["tabular-nums"] },
  dots: { flexDirection: "row", gap: 3, marginTop: 3, height: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  day: { marginHorizontal: 12, marginTop: 10, borderRadius: 28, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, minHeight: 220, backgroundColor: "#1a2a8c", experimental_backgroundImage: haloAt(3, "70% 0%") },
});
