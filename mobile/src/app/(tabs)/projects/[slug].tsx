// 專案詳細：大字是專案名，下面是階段、連結（圓鈕）、下一步、接下來的排程與里程碑、工作日誌
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { View } from "react-native";
import { Icon, type IconName } from "@/components/Icon";
import { Orb } from "@/components/Orb";
import { Bars, Big, Box, Dot, Empty, ErrorNote, Label, Line, Loading, Page, projectColor, RoundButton, Small, TimeCell, Txt } from "@/components/ui";
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
  const back = <View style={{ marginLeft: -10 }}><RoundButton icon="back" label={L("回到專案", "Back to projects")} onPress={() => router.back()} size={44} /></View>;

  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh} top={0}>{back}{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const p = data.project;
  const links = Object.entries(p.links).filter(([, url]) => url);
  const status = p.status === "paused" ? L("，暫停中", ", paused") : p.status === "done" ? L("，已完成", ", done") : "";
  const later = [
    ...data.events.map((e) => ({ key: `e${e.id}`, day: e.start_date, title: `${e.start_time ? `${e.start_time} ` : ""}${e.title}`, milestone: false })),
    ...data.milestones.filter((m) => !m.done).map((m) => ({ key: `m${m.id}`, day: m.due, title: m.title, milestone: true })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const logs = data.logs.slice(0, 15);

  return (
    <Page refreshing={refreshing} onRefresh={refresh} top={0}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        {back}
        <View style={{ marginRight: 96 }}><Small icon="clock" iconLabel={L("上次有動靜", "Last activity")}>{ago(p.last_activity_at)}</Small></View>
      </View>
      <Orb size={136} mood={p.status === "active" ? "busy" : "sleep"} style={{ position: "absolute", right: -36, top: 84 }} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 24, marginRight: 96 }}>
        <Dot color={projectColor(p.id)} size={10} />
        <View style={{ flex: 1 }}><Big lines={1}>{p.name}</Big></View>
      </View>
      <Txt muted tab style={{ marginTop: 8 }}>{`${p.stages[p.stage_index] ?? "—"}，${p.stage_index + 1}/${p.stages.length}${status}`}</Txt>
      {p.stages.length ? <Bars done={p.stage_index + 1} total={p.stages.length} /> : null}

      {links.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          {links.map(([k, url]) => <RoundButton key={k} icon={LINK[k]?.icon ?? "link"} label={LINK[k]?.label() ?? k} onPress={() => WebBrowser.openBrowserAsync(url)} />)}
        </View>
      ) : null}

      <Box style={{ marginTop: 20 }}>
        <Txt size={14} lh={20} muted>{L("下一步", "Next")}</Txt>
        <Txt size={20} lh={28} style={{ marginTop: 4 }}>{p.next_step ?? L("還沒設定", "Not set")}</Txt>
      </Box>
      {p.description ? <Txt size={14} lh={20} muted style={{ marginTop: 12 }}>{p.description}</Txt> : null}

      <Label icon="flag">{L("接下來", "Coming up")}</Label>
      {later.length ? (
        later.map((it, i) => {
          const n = daysBetween(today, it.day);
          return (
            <Line key={it.key} last={i === later.length - 1}>
              <TimeCell strong={n <= 1}>{mdShort(it.day)}</TimeCell>
              <Txt style={{ flex: 1 }} numberOfLines={2}>{it.title}</Txt>
              <Small color={n < 0 ? t.badText : undefined} icon={it.milestone ? "flag" : undefined} iconLabel={L("里程碑", "Milestone")}>{relDay(today, it.day)}</Small>
            </Line>
          );
        })
      ) : (
        <Empty text={L("接下來沒有排程或里程碑", "No events or milestones ahead")} />
      )}

      <Label icon="note">{L("日誌", "Log")}</Label>
      {logs.length ? (
        logs.map((l, i) => (
          <Line key={l.id} last={i === logs.length - 1} style={{ alignItems: "flex-start", paddingVertical: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt size={15} lh={22}>{l.text}</Txt>
              <Txt size={13} lh={18} muted style={{ marginTop: 2 }}>{`${ago(l.at)}　${SOURCE(l.source)}`}</Txt>
            </View>
          </Line>
        ))
      ) : (
        <Empty text={L("還沒有紀錄", "No entries yet")} />
      )}
    </Page>
  );
}
