// 月曆（2.4 柔和卡片版）：月份與格子在一張卡片裡（選到的日子是主色圓盤，今天是主色圓框，有事的日子底下一個重點色的點），
// 下面是選到那天的事：時間在左、卡片在右
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/Icon";
import { Card, Dot, Empty, ErrorNote, Head, Page, projectColor, Sec, Tag, TimeRow, Txt } from "@/components/ui";
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
  const cell = Math.floor((useWindowDimensions().width - 60) / 7);
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

  const nextId = selected === today ? dayEvents.find((e) => e.start_time && !pastBy(e.start_time, nowHm ?? "00:00"))?.id : undefined;
  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head title={L("月曆", "Calendar")} sub={month === today.slice(0, 7) ? L(`這週 ${thisWeek} 件`, `${thisWeek} this week`) : undefined} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      {/* 月份與格子放在同一張卡片裡 */}
      <Card top={16} style={{ paddingHorizontal: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 6, marginBottom: 6 }}>
          <Txt med size={17} lh={24} style={{ flex: 1 }}>{lang() === "en" ? `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}` : `${month.slice(0, 4)} 年 ${+month.slice(5, 7)} 月`}</Txt>
          {month !== today.slice(0, 7) ? (
            <Pressable hitSlop={10} accessibilityRole="button" onPress={() => { setMonth(today.slice(0, 7)); setSelected(today); }} style={{ marginRight: 10 }}>
              <Txt size={13.5} color={t.main}>{L("回今天", "Today")}</Txt>
            </Pressable>
          ) : null}
          <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={L("上個月", "Previous month")} onPress={() => go(-1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.soft, alignItems: "center", justifyContent: "center", marginRight: 6 }}><Icon name="back" size={16} color={t.ink} /></Pressable>
          <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={L("下個月", "Next month")} onPress={() => go(1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.soft, alignItems: "center", justifyContent: "center" }}><Icon name="chev" size={16} color={t.ink} /></Pressable>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {week.map((w, i) => <Txt key={i} size={12} lh={24} muted style={{ width: cell, textAlign: "center" }}>{w}</Txt>)}
          {cells.map((d, i) => {
            if (!d) return <View key={`x${i}`} style={{ width: cell, height: 44 }} />;
            const sel = d === selected;
            const isToday = d === today;
            return (
              <Pressable key={d} onPress={() => setSelected(d)} accessibilityRole="button" accessibilityState={{ selected: sel }} accessibilityLabel={`${md(d)}${busy.has(d) ? L("，有事", ", has events") : ""}`} style={{ width: cell, height: 44, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: sel ? t.main : "transparent", borderWidth: isToday && !sel ? 1.5 : 0, borderColor: t.main }}>
                  <Txt num size={14} lh={18} color={sel ? t.onMain : d < today ? t.muted : t.ink}>{+d.slice(8, 10)}</Txt>
                </View>
                <View style={{ position: "absolute", bottom: 1, width: 4, height: 4, borderRadius: 2, backgroundColor: busy.has(d) && !sel ? t.acc : "transparent" }} />
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Sec right={rows.length ? L(`${rows.length} 件`, `${rows.length}`) : undefined}>{`${md(selected)}${selected === today ? `　${L("今天", "Today")}` : ""}`}</Sec>
      {rows.length ? (
        rows.map((r) => (
          <TimeRow key={r.key} time={r.milestone ? L("到期", "Due") : r.time ?? L("整天", "All day")} past={r.past}>
            <Card top={0} tone={r.key === nextId ? "main" : undefined}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Txt med size={15} lh={21} color={r.key === nextId ? t.onMain : undefined} numberOfLines={2} style={{ flex: 1 }}>{r.title}</Txt>
                {r.key === nextId ? <Tag tone="acc">{L("下一件", "Next")}</Tag> : r.milestone ? <Tag>{L("待辦", "To-do")}</Tag> : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                <Dot color={projectColor(r.project)} size={7} />
                <Txt size={13} lh={18} color={r.key === nextId ? t.onMain : t.muted} style={{ opacity: r.key === nextId ? 0.8 : 1 }} numberOfLines={1}>{name.get(r.project) ?? ""}</Txt>
              </View>
            </Card>
          </TimeRow>
        ))
      ) : (
        <Empty text={data ? L("這天沒有排程", "Nothing on this day") : L("讀取中", "Loading")} />
      )}
    </Page>
  );
}
