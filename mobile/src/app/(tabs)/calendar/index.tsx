// 月曆：上面是月份與格子（今天是實心圓，有事的日子底下一個點），下面是選到那天的事
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/Icon";
import { Big, Dot, Empty, ErrorNote, Head, Label, Line, Page, projectColor, RoundButton, Small, TimeCell, Txt } from "@/components/ui";
import { addDays, md, pastBy, taipeiHm, taipeiToday } from "@/lib/format";
import { L, lang } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { CalendarData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shiftMonth(month: string, n: number): string {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default function CalendarScreen() {
  const t = useTheme();
  const today = taipeiToday();
  // 一格的寬度用算的（用百分比排七格會因為四捨五入擠到下一排）
  const cell = Math.floor((useWindowDimensions().width - 40) / 7);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const { data, error, refreshing, refresh } = useApi<CalendarData>(`/api/app/calendar?month=${month}`);
  const week = lang() === "en" ? ["S", "M", "T", "W", "T", "F", "S"] : ["日", "一", "二", "三", "四", "五", "六"];

  // 一週從星期日開始；只畫這個月的日子，前面空格補齊
  const cells = useMemo(() => {
    const first = `${month}-01`;
    const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
    const last = +addDays(shiftMonth(month, 1) + "-01", -1).slice(8, 10);
    return [...Array.from({ length: dow }, () => null), ...Array.from({ length: last }, (_, i) => addDays(first, i))];
  }, [month]);

  const busy = useMemo(() => {
    const s = new Set<string>();
    for (const e of data?.events ?? []) for (let d = e.start_date; d <= e.end_date; d = addDays(d, 1)) s.add(d);
    for (const ms of data?.milestones ?? []) s.add(ms.due);
    return s;
  }, [data]);

  const name = new Map((data?.projects ?? []).map((p) => [p.id, p.name]));
  const dayEvents = (data?.events ?? []).filter((e) => e.start_date <= selected && e.end_date >= selected).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  const dayMs = (data?.milestones ?? []).filter((m) => m.due === selected);
  const nowHm = selected === today ? taipeiHm() : null;
  const rows = [
    ...dayMs.map((m) => ({ key: `m${m.id}`, time: null as string | null, title: m.title, project: m.project_id, milestone: true, past: m.done })),
    ...dayEvents.map((e) => ({ key: e.id, time: e.start_time, title: e.title, project: e.project_id, milestone: false, past: !!nowHm && pastBy(e.start_time, nowHm) })),
  ];
  const weekEnd = addDays(today, 6);
  const thisWeek = (data?.events ?? []).filter((e) => e.start_date <= weekEnd && e.end_date >= today).length + (data?.milestones ?? []).filter((m) => m.due >= today && m.due <= weekEnd).length;

  const go = (n: number) => {
    const next = shiftMonth(month, n);
    setMonth(next);
    setSelected(next === today.slice(0, 7) ? today : `${next}-01`);
    Haptics.selectionAsync().catch(() => null);
  };

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head title={L("月曆", "Calendar")} right={month === today.slice(0, 7) ? <><Icon name="tasks" size={16} color={t.muted} /><Txt size={14} lh={20} muted tab>{L(`這週 ${thisWeek} 件`, `${thisWeek} this week`)}</Txt></> : null} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 40 }}>
        <View style={{ flex: 1 }}>
          <Big lines={1}>{lang() === "en" ? `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}` : `${+month.slice(5, 7)} 月`}</Big>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {month !== today.slice(0, 7) ? (
            <Pressable hitSlop={12} accessibilityRole="button" onPress={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>
              <Txt size={14} style={{ textDecorationLine: "underline", marginRight: 4 }}>{L("回今天", "Today")}</Txt>
            </Pressable>
          ) : null}
          <RoundButton icon="back" label={L("上個月", "Previous month")} onPress={() => go(-1)} />
          <RoundButton icon="chev" label={L("下個月", "Next month")} onPress={() => go(1)} />
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 20, marginHorizontal: -8 }}>
        {week.map((w, i) => <Txt key={i} size={12} lh={24} muted style={{ width: cell, textAlign: "center" }}>{w}</Txt>)}
        {cells.map((d, i) => {
          if (!d) return <View key={`x${i}`} style={{ width: cell, height: 48 }} />;
          const sel = d === selected;
          const isToday = d === today;
          return (
            <Pressable key={d} onPress={() => setSelected(d)} accessibilityRole="button" accessibilityState={{ selected: sel }} accessibilityLabel={`${md(d)}${busy.has(d) ? L("，有事", ", has events") : ""}`} style={{ width: cell, height: 48, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: sel ? t.ink : "transparent", borderWidth: isToday && !sel ? 1 : 0, borderColor: t.ink }}>
                <Txt size={15} lh={18} tab color={sel ? t.bg : d < today ? t.muted : t.ink}>{+d.slice(8, 10)}</Txt>
              </View>
              <View style={{ position: "absolute", bottom: 1, width: 4, height: 4, borderRadius: 2, backgroundColor: busy.has(d) && !sel ? t.ink : "transparent" }} />
            </Pressable>
          );
        })}
      </View>

      <Label top={20}>{md(selected)}{selected === today ? `　${L("今天", "Today")}` : ""}</Label>
      {rows.length ? (
        rows.map((r, i) => (
          <Line key={r.key} last={i === rows.length - 1} style={{ opacity: r.past ? 0.5 : 1 }}>
            {r.milestone ? <View style={{ width: 48 }}><Icon name="flag" size={16} color={t.ink} label={L("里程碑", "Milestone")} /></View> : <TimeCell strong={!!r.time}>{r.time ?? L("整天", "All day")}</TimeCell>}
            <Txt style={{ flex: 1 }} numberOfLines={2}>{r.title}</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 96 }}>
              <Dot color={projectColor(r.project)} />
              <Small>{name.get(r.project) ?? ""}</Small>
            </View>
          </Line>
        ))
      ) : (
        <Empty text={data ? L("這天沒有排程", "Nothing on this day") : L("讀取中", "Loading")} />
      )}
    </Page>
  );
}
