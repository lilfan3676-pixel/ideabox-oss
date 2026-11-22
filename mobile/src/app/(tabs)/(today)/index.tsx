// 今天（2.4 柔和卡片版）：最上面一排日期小膠囊（今天起六天、每天幾件事），
// 一張主色的大卡講「下一件」，下面是時間在左、卡片在右的時間軸，最後是各專案的小卡（可以左右滑）。
// 整頁可以上下捲、往下拉更新；點別的日子就看那一天的事。
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Card, Dot, Empty, ErrorNote, Head, Loading, Page, Progress, projectColor, Sec, Tag, TimeRow, Txt } from "@/components/ui";
import { addDays, pastBy, taipeiHm, weekday } from "@/lib/format";
import { L } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { getSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { AppEvent, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** 合夥人的手機沒有這個畫面就不跳過去（舊的配對沒有 tabs＝全部都有） */
const canSee = (tab: string) => {
  const tabs = getSession()?.tabs;
  return !tabs || tabs.includes(tab);
};

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
/** 「還有 2 小時」「還有 35 分鐘」 */
function until(nowHm: string, at: string): string {
  const m = toMin(at) - toMin(nowHm);
  if (m <= 0) return L("進行中", "now");
  if (m < 60) return L(`還有 ${m} 分鐘`, `in ${m} min`);
  return L(`還有 ${Math.round(m / 60)} 小時`, `in ${Math.round(m / 60)} h`);
}
const partOfDay = (hm: string) => (+hm.slice(0, 2) < 12 ? L("上午", "AM") : +hm.slice(0, 2) < 18 ? L("下午", "PM") : L("晚上", "eve"));

export default function Today() {
  const t = useTheme();
  usePrefs();
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  const [picked, setPicked] = useState<string | null>(null); // 選到哪一天（沒選＝今天）

  const today = data?.today ?? "";
  const day = picked && today && picked >= today ? picked : today;
  const days = useMemo(() => (today ? Array.from({ length: 6 }, (_, i) => addDays(today, i)) : []), [today]);
  const onDay = (d: string) => (data?.events ?? []).filter((e) => e.start_date <= d && e.end_date >= d).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));

  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}><Head title={L("今天", "Today")} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const nowHm = taipeiHm();
  const isToday = day === today;
  const list = onDay(day);
  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  const past = (e: AppEvent) => isToday && pastBy(e.start_time, nowHm);
  const done = list.filter(past).length;
  // 「下一件」：今天還沒過、有時間的第一件；沒有就整天的事；別的日子就是那天的第一件
  const next = list.find((e) => e.start_time && !past(e)) ?? list.find((e) => !e.start_time) ?? (isToday ? undefined : list[0]);
  const rest = list.filter((e) => e.id !== next?.id);
  const active = data.projects.filter((p) => p.status === "active");
  const overdue = data.overdue ?? 0;
  const dueSoon = data.milestones.filter((m) => !m.done && m.due === day);

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head
        sub={`${+day.slice(5, 7)} ${L("月", "/")} ${+day.slice(8, 10)}${L(" 日", "")}　${L("週", "")}${weekday(day)}`}
        title={isToday ? L(`今天 ${list.length} 件事`, `${list.length} today`) : L(`這天 ${list.length} 件事`, `${list.length} that day`)}
        right={isToday && list.length ? <Tag big>{L(`做完 ${done} 件`, `${done} done`)}</Tag> : undefined}
      />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      {/* 今天起六天，一天一顆膠囊：星期、日期、那天幾件事 */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }} accessibilityRole="tablist">
        {days.map((d) => {
          const on = d === day;
          const n = onDay(d).length;
          return (
            <Pressable
              key={d}
              onPress={() => {
                Haptics.selectionAsync().catch(() => null);
                setPicked(d === today ? null : d);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${+d.slice(5, 7)}/${+d.slice(8, 10)}，${L(`${n} 件事`, `${n} things`)}`}
              style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 20, backgroundColor: on ? t.main : t.card }}
            >
              <Txt size={11.5} lh={16} color={on ? t.onMain : t.muted} style={{ opacity: on ? 0.8 : 1 }}>{weekday(d)}</Txt>
              <Txt num size={19} lh={28} color={on ? t.onMain : t.ink}>{+d.slice(8, 10)}</Txt>
              <Txt size={11.5} lh={16} color={on ? t.onMain : t.muted} style={{ opacity: on ? 0.8 : 1 }}>{n ? L(`${n} 件`, `${n}`) : "—"}</Txt>
            </Pressable>
          );
        })}
      </View>

      {/* 下一件：整張主色，重點色的小標籤 */}
      {next ? (
        <Card tone="main" top={14} style={{ borderRadius: 24, paddingVertical: 16, paddingHorizontal: 18 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Tag tone="acc">{isToday ? L("下一件", "Next") : L("第一件", "First")}</Tag>
            <Txt size={13.5} lh={19} color={t.onMain} style={{ flex: 1, opacity: 0.8 }} numberOfLines={1}>{next.start_time ? (isToday ? until(nowHm, next.start_time) : "") : L("整天", "All day")}</Txt>
            {next.start_time ? <Txt num size={22} lh={28} color={t.onMain}>{next.start_time}</Txt> : null}
          </View>
          <Txt med size={22} lh={30} color={t.onMain} style={{ marginTop: 8 }} numberOfLines={3}>{next.title}</Txt>
          {name.get(next.project_id) ? <Txt size={13.5} lh={19} color={t.onMain} style={{ marginTop: 4, opacity: 0.8 }}>{name.get(next.project_id)}</Txt> : null}
        </Card>
      ) : (
        <Card top={14}>
          <Txt med size={18} lh={26}>{list.length ? L("今天的事都過了", "All done for today") : isToday ? L("今天沒有排程", "Nothing planned today") : L("這天沒有排程", "Nothing planned")}</Txt>
          <Txt size={13.5} lh={20} muted style={{ marginTop: 4 }}>{L("照各專案的下一步做就好", "Just follow each project's next step")}</Txt>
        </Card>
      )}

      {/* 時間軸：時間在左、卡片在右 */}
      {rest.map((e) => (
        <TimeRow key={e.id} time={e.start_time ?? L("整天", "All day")} sub={e.start_time ? partOfDay(e.start_time) : undefined} past={past(e)}>
          <Card top={0}>
            <Txt med size={15} lh={21} numberOfLines={2}>{e.title}</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Tag tone={past(e) ? "main" : undefined}>{past(e) ? L("做完了", "Done") : isToday ? L("待會", "Later") : L("排定", "Planned")}</Tag>
              <View style={{ flex: 1 }} />
              <Dot color={projectColor(e.project_id)} size={7} />
              <Txt size={13} lh={18} muted numberOfLines={1} style={{ maxWidth: 110 }}>{name.get(e.project_id) ?? ""}</Txt>
            </View>
          </Card>
        </TimeRow>
      ))}
      {dueSoon.map((m) => (
        <TimeRow key={m.id} time={L("到期", "Due")}>
          <Card top={0}>
            <Txt med size={15} lh={21} numberOfLines={2}>{m.title}</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Tag>{L("待辦", "To-do")}</Tag>
              <View style={{ flex: 1 }} />
              <Dot color={projectColor(m.project_id)} size={7} />
              <Txt size={13} lh={18} muted numberOfLines={1} style={{ maxWidth: 110 }}>{name.get(m.project_id) ?? ""}</Txt>
            </View>
          </Card>
        </TimeRow>
      ))}

      {/* 各專案：小卡可以左右滑，點了進專案詳細 */}
      {active.length ? (
        <>
          <Sec right={overdue > 0 ? <Tag tone="bad">{L(`${overdue} 件過期`, `${overdue} overdue`)}</Tag> : undefined}>{L("各專案", "Projects")}</Sec>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
            {active.map((p) => (
              <Pressable key={p.id} onPress={canSee("projects") ? () => router.navigate({ pathname: "/projects/[slug]", params: { slug: p.slug } }) : undefined} accessibilityRole="button" accessibilityLabel={`${p.name}，${p.next_step ?? L("還沒寫下一步", "no next step")}`} style={({ pressed }) => ({ width: 150, padding: 14, borderRadius: 20, backgroundColor: t.card, opacity: pressed ? 0.7 : 1 })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Dot color={projectColor(p.id)} />
                  <Txt med size={15} lh={21} numberOfLines={1} style={{ flex: 1 }}>{p.name}</Txt>
                </View>
                <Txt size={12.5} lh={18} muted numberOfLines={2} style={{ marginTop: 4, height: 36 }}>{p.next_step ?? L("還沒寫下一步", "No next step")}</Txt>
                <Progress frac={p.stage_count ? (p.stage_index + 1) / p.stage_count : 0} />
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : !list.length ? (
        <Empty text={L("還沒有專案，到 ideabox 網頁新增。", "No projects yet. Add one on the ideabox website.")} />
      ) : null}
    </Page>
  );
}
