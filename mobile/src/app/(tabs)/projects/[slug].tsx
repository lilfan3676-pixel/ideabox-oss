// 專案詳細（2.4 柔和卡片版）：專案名與階段、整張主色的「下一步」、三個數字（過期／這週到期／待辦）、
// 待辦清單（過期的有紅色標籤）、接下來的排程、最近做了什麼。沒有導覽列，左上角返回。
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { type IconName } from "@/components/Icon";
import { Card, Dot, Empty, ErrorNote, Line, Loading, Page, Progress, projectColor, RoundButton, Sec, Stat, Tag, Txt } from "@/components/ui";
import { ago, daysBetween, mdShort, relDay, taipeiToday } from "@/lib/format";
import { L } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { ProjectData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const SOURCE = (s: string) => ({ manual: L("網頁", "Web"), telegram: "Telegram", claude: "Claude", github: "GitHub", slack: "Slack", system: L("系統", "System") })[s] ?? s;
const LINK: Record<string, { label: () => string; icon: IconName }> = {
  website: { label: () => L("官網", "Website"), icon: "globe" },
  instagram: { label: () => "Instagram", icon: "at" },
  threads: { label: () => "Threads", icon: "at" },
  facebook: { label: () => "Facebook", icon: "users" },
  line: { label: () => "LINE", icon: "chat" },
  youtube: { label: () => "YouTube", icon: "link" },
  app: { label: () => L("App 下載", "App download"), icon: "phone" },
};

export default function ProjectDetail() {
  const t = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, error, loading, refreshing, refresh } = useApi<ProjectData>(`/api/app/projects/${encodeURIComponent(slug)}`);
  const today = taipeiToday();
  const back = <RoundButton icon="back" label={L("回到專案", "Back to projects")} onPress={() => router.back()} />;

  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}>{back}{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const p = data.project;
  const links = Object.entries(p.links).filter(([, url]) => url);
  const status = p.status === "paused" ? L("，暫停中", ", paused") : p.status === "done" ? L("，已完成", ", done") : "";
  // 待辦：有日期的近的在前（過期的最前面），沒日期的排後面
  const dated = data.milestones.filter((m) => !m.done).map((m) => ({ id: m.id, title: m.title, n: daysBetween(today, m.due) as number | null })).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const todos = [...dated, ...(data.todos ?? []).map((x) => ({ id: x.id, title: x.title, n: null as number | null }))];
  const late = dated.filter((m) => (m.n ?? 0) < 0).length;
  const week = dated.filter((m) => (m.n ?? 0) >= 0 && (m.n ?? 0) <= 7).length;
  const events = data.events.slice(0, 6);
  const logs = data.logs.slice(0, 12);
  const SHOW = 6;

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {back}
        <Txt size={13.5} lh={19} muted tab accessibilityLabel={L(`上次有動靜 ${ago(p.last_activity_at)}`, `Last activity ${ago(p.last_activity_at)}`)}>{L(`${ago(p.last_activity_at)}更新`, `Updated ${ago(p.last_activity_at)}`)}</Txt>
      </View>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Dot color={projectColor(p.id)} size={10} />
        <Txt med size={30} lh={36} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ flex: 1 }} accessibilityRole="header">{p.name}</Txt>
        <Tag big>{`${p.stages[p.stage_index] ?? "—"}${p.stages.length ? `　${p.stage_index + 1}/${p.stages.length}` : ""}${status}`}</Tag>
      </View>
      {p.stages.length ? <Progress frac={(p.stage_index + 1) / p.stages.length} top={12} /> : null}

      <Card tone="main" top={14} style={{ borderRadius: 24, paddingVertical: 16, paddingHorizontal: 18 }}>
        <Tag tone="acc">{L("下一步", "Next")}</Tag>
        <Txt med size={18} lh={27} color={t.onMain} style={{ marginTop: 8 }}>{p.next_step ?? L("還沒設定", "Not set")}</Txt>
      </Card>

      <Stat items={[{ v: late, label: L("過期", "overdue"), color: late ? t.bad : undefined }, { v: week, label: L("這週到期", "due this week") }, { v: todos.length, label: L("待辦", "to-dos") }]} />

      {links.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {links.map(([k, url]) => <RoundButton key={k} icon={LINK[k]?.icon ?? "link"} label={LINK[k]?.label() ?? k} onPress={() => WebBrowser.openBrowserAsync(url)} />)}
        </View>
      ) : null}

      <Sec>{L("待辦", "To-dos")}</Sec>
      {todos.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {todos.slice(0, SHOW).map((it, i) => (
            <Line key={it.id} first={i === 0}>
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: t.muted, opacity: 0.6 }} />
              <Txt size={14.5} lh={21} style={{ flex: 1 }} numberOfLines={2}>{it.title}</Txt>
              {it.n == null ? null : it.n < 0 ? <Tag tone="bad">{L(`過期 ${-it.n} 天`, `${-it.n}d late`)}</Tag> : <Tag>{it.n === 0 ? L("今天", "Today") : L(`${it.n} 天後`, `in ${it.n}d`)}</Tag>}
            </Line>
          ))}
          {todos.length > SHOW ? <Line><Txt size={13.5} lh={20} muted style={{ flex: 1 }}>{L(`還有 ${todos.length - SHOW} 件，到網頁看全部`, `${todos.length - SHOW} more on the website`)}</Txt></Line> : null}
        </Card>
      ) : (
        <Empty text={L("沒有還沒做的待辦", "Nothing left to do")} />
      )}

      {events.length ? (
        <>
          <Sec>{L("接下來的排程", "Schedule")}</Sec>
          <Card style={{ paddingVertical: 4 }}>
            {events.map((e, i) => (
              <Line key={e.id} first={i === 0}>
                <Txt num size={13.5} lh={20} style={{ width: 46 }}>{mdShort(e.start_date)}</Txt>
                <Txt size={14.5} lh={21} style={{ flex: 1 }} numberOfLines={2}>{`${e.start_time ? `${e.start_time} ` : ""}${e.title}`}</Txt>
                <Txt size={13} lh={18} muted>{relDay(today, e.start_date < today ? today : e.start_date)}</Txt>
              </Line>
            ))}
          </Card>
        </>
      ) : null}

      <Sec right={logs.length ? L(`最近 ${logs.length} 筆`, `last ${logs.length}`) : undefined}>{L("最近做了什麼", "Recent work")}</Sec>
      {logs.length ? (
        <Card style={{ paddingVertical: 4 }}>
          {logs.map((l, i) => (
            <Line key={l.id} first={i === 0} style={{ alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Txt size={14.5} lh={21}>{l.text}</Txt>
                <Txt size={12.5} lh={18} muted style={{ marginTop: 2 }}>{`${ago(l.at)}　${SOURCE(l.source)}`}</Txt>
              </View>
            </Line>
          ))}
        </Card>
      ) : (
        <Empty text={L("還沒有紀錄", "No entries yet")} />
      )}
      {p.description ? <Txt size={13} lh={20} muted style={{ marginTop: 14 }}>{p.description}</Txt> : null}
    </Page>
  );
}
