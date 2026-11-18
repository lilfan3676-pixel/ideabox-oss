// 今天：最上面一張主色大卡講「下一件事」，產品掛掉用紅色提醒條，其餘清單縮小、變淡（重點分層 A）
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Chips, Compact, soft } from "@/components/blocks";
import { Dot, Empty, ErrorNote, Loading, projectColor, Row, Screen, Section } from "@/components/ui";
import { taipeiHm } from "@/lib/assistant";
import { addDays, daysBetween, md, relDay } from "@/lib/format";
import { useTheme, type Palette } from "@/lib/theme";
import type { AppEvent, AppMilestone, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { getSession } from "@/lib/session";

/** 合夥人的手機沒有這個分頁就不跳過去（舊的配對沒有 tabs＝全部都有） */
const canSee = (tab: string) => {
  const tabs = getSession()?.tabs;
  return !tabs || tabs.includes(tab);
};

type Next = { kicker: string; time: string | null; title: string; project?: string };

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

/** 「2 小時後」「35 分鐘後」 */
function until(nowHm: string, at: string): string {
  const m = toMin(at) - toMin(nowHm);
  if (m <= 0) return "進行中";
  if (m < 60) return `${m} 分鐘後`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r >= 30 ? `${h} 個半小時後` : `${h} 小時後`;
}

/** 大卡要講的事：今天接下來有時間的排程 → 今天整天的 → 之後最近的一件 */
function nextThing(d: HomeData, todayEvents: AppEvent[], upcoming: AppEvent[], nowHm: string, name: Map<string, string>): Next | null {
  const timed = todayEvents.find((e) => e.start_time && toMin(e.start_time) + 30 > toMin(nowHm));
  if (timed) return { kicker: `下一件事・${until(nowHm, timed.start_time!)}`, time: timed.start_time, title: timed.title, project: name.get(timed.project_id) };
  const allDay = todayEvents.find((e) => !e.start_time);
  if (allDay) return { kicker: "今天要做", time: null, title: allDay.title, project: name.get(allDay.project_id) };
  const soon = upcoming[0];
  if (soon) return { kicker: `接下來・${relDay(d.today, soon.start_date)}`, time: soon.start_time, title: soon.title, project: name.get(soon.project_id) };
  return null;
}

export default function Today() {
  const t = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  if (loading && !data) return <Loading />;
  if (!data) return <Screen onRefresh={refresh}>{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Screen>;

  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  const today = data.today;
  const nowHm = taipeiHm();
  const todayEvents = data.events
    .filter((e) => e.start_date <= today && e.end_date >= today)
    .sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  const upcoming = data.events.filter((e) => e.start_date > today).sort((a, b) => (a.start_date + (a.start_time ?? "99")).localeCompare(b.start_date + (b.start_time ?? "99")));
  const down = data.monitor.filter((m) => !m.ok);
  const active = data.projects.filter((p) => p.status === "active");
  const next = nextThing(data, todayEvents, upcoming, nowHm, name);
  const soonMs = data.milestones.filter((m) => m.due <= addDays(today, 7)).sort((a, b) => a.due.localeCompare(b.due))[0];

  // 「接下來」：之後的排程和里程碑混在一起照日期排
  type Item = { key: string; day: string; title: string; sub: string; milestone: boolean; color: string };
  const later: Item[] = [
    ...upcoming.map((e) => ({ key: `e${e.id}`, day: e.start_date, title: `${e.start_time ? `${e.start_time} ` : ""}${e.title}${e.end_date > e.start_date ? `（到 ${md(e.end_date)}）` : ""}`, sub: name.get(e.project_id) ?? "", milestone: false, color: projectColor(e.project_id) })),
    ...data.milestones.filter((m) => m.due > today).map((m: AppMilestone) => ({ key: `m${m.id}`, day: m.due, title: m.title, sub: `${name.get(m.project_id) ?? ""} 里程碑`, milestone: true, color: projectColor(m.project_id) })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      <View style={{ marginHorizontal: 20, marginTop: 4, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 15, color: t.muted, fontWeight: "600" }}>{md(today)}</Text>
        {data.monitor.length > 0 && !down.length ? (
          <Text style={{ fontSize: 13, color: t.ok, fontWeight: "700" }}>● {data.monitor.length} 項服務正常</Text>
        ) : null}
      </View>

      {/* 主角：下一件事 */}
      <HeroCard t={t} next={next} todayCount={todayEvents.length} milestone={soonMs ? `${relDay(today, soonMs.due)}：${soonMs.title}` : null} />

      {/* 產品掛掉：紅色提醒條，一項一條 */}
      {down.map((m) => (
        <View key={m.service} accessibilityRole="alert" style={{ marginHorizontal: 16, marginTop: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: soft(t.danger, 0.12), borderWidth: 1, borderColor: soft(t.danger, 0.35) }}>
          <Dot color={t.danger} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: t.danger }} numberOfLines={1}>{m.label} 連不上</Text>
          {m.error ? <Text style={{ fontSize: 13, color: t.muted }} numberOfLines={1}>{m.error}</Text> : null}
        </View>
      ))}

      <Section title="今天">
        {todayEvents.length ? (
          todayEvents.map((e, i) => (
            <Compact key={e.id} t={t} left={e.start_time ?? "整天"} leftStrong={!!e.start_time} title={e.title + (e.end_date > e.start_date ? `（到 ${md(e.end_date)}）` : "")} right={name.get(e.project_id)} last={i === todayEvents.length - 1} />
          ))
        ) : (
          <Empty text="今天沒有排程" />
        )}
      </Section>

      {later.length > 0 && (
        <Section title="接下來">
          {later.map((it, i) => {
            const n = daysBetween(today, it.day);
            return (
              <Compact
                key={it.key}
                t={t}
                left={n <= 2 ? relDay(today, it.day) : `${+it.day.slice(5, 7)}/${+it.day.slice(8, 10)}`}
                leftColor={n <= 1 ? t.warn : undefined}
                leftStrong={n <= 1}
                title={(it.milestone ? "◆ " : "") + it.title}
                right={it.sub}
                dot={it.color}
                last={i === later.length - 1}
              />
            );
          })}
        </Section>
      )}

      <Section title="進行中的專案">
        {active.length ? (
          active.map((p, i) => (
            <Row
              key={p.id}
              left={<Dot color={projectColor(p.id)} />}
              title={p.name}
              subtitle={[p.stage ? `${p.stage}（${p.stage_index + 1}/${p.stage_count}）` : null, p.next_step ? `下一步：${p.next_step}` : null].filter(Boolean).join("\n")}
              onPress={canSee("projects") ? () => router.navigate({ pathname: "/projects/[slug]", params: { slug: p.slug } }) : undefined}
              last={i === active.length - 1}
            />
          ))
        ) : (
          <Empty text="沒有進行中的專案" />
        )}
      </Section>
    </Screen>
  );
}

function HeroCard({ t, next, todayCount, milestone }: { t: Palette; next: Next | null; todayCount: number; milestone: string | null }) {
  const chips = [todayCount ? `今天 ${todayCount} 個排程` : null, milestone].filter(Boolean) as string[];
  if (!next) {
    return (
      <View style={{ marginHorizontal: 16, marginTop: 12, borderRadius: 22, padding: 18, backgroundColor: soft(t.accent, 0.12) }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: t.text }}>沒有排程，專心做事</Text>
        <Text style={{ fontSize: 14, color: t.muted, marginTop: 4 }}>接下來 14 天都沒有安排。</Text>
        {chips.length ? <Chips chips={chips} color={t.text} bg={soft(t.accent, 0.16)} /> : null}
      </View>
    );
  }
  const fg = "#ffffff";
  return (
    <Pressable
      onPress={() => canSee("calendar") && router.navigate("/calendar")}
      accessibilityRole="button"
      accessibilityLabel={`${next.kicker}，${next.time ?? ""} ${next.title}，${next.project ?? ""}。點一下看月曆`}
      style={({ pressed }) => ({ marginHorizontal: 16, marginTop: 12, borderRadius: 22, padding: 18, paddingBottom: 16, backgroundColor: t.accent, opacity: pressed ? 0.92 : 1, boxShadow: `0px 10px 28px ${soft(t.accent, 0.35)}` })}
    >
      <Text style={{ fontSize: 13, fontWeight: "700", color: fg, opacity: 0.88 }}>{next.kicker}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
        {next.time ? <Text style={{ fontSize: 34, fontWeight: "800", color: fg, fontVariant: ["tabular-nums"] }}>{next.time}</Text> : null}
        <Text style={{ fontSize: next.time ? 20 : 24, fontWeight: "800", color: fg, flexShrink: 1 }}>{next.title}</Text>
      </View>
      {next.project ? <Text style={{ fontSize: 14, color: fg, opacity: 0.9, marginTop: 2 }}>{next.project}</Text> : null}
      {chips.length ? <Chips chips={chips} color={fg} bg="rgba(255,255,255,0.22)" /> : null}
    </Pressable>
  );
}
