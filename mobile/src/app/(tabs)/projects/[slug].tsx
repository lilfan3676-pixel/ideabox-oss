// 單一專案：主角是「目前階段＋下一步」大卡；接下來的排程與里程碑合成一張精簡清單；日誌縮小變淡
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Compact, Progress } from "@/components/blocks";
import { Empty, ErrorNote, Loading, projectIndex, Screen, Section } from "@/components/ui";
import { ago, daysBetween, md, relDay, taipeiToday } from "@/lib/format";
import { haloAt, useTheme } from "@/lib/theme";
import type { ProjectData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const SOURCE: Record<string, string> = { manual: "網頁", telegram: "Telegram", claude: "Claude", github: "GitHub", slack: "Slack", system: "系統" };
const LINK: Record<string, string> = { website: "官網", instagram: "Instagram", threads: "Threads", facebook: "Facebook", line: "LINE", youtube: "YouTube", app: "App 下載" };

export default function ProjectDetail() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, error, loading, refreshing, refresh } = useApi<ProjectData>(`/api/app/projects/${encodeURIComponent(slug)}`);
  const today = taipeiToday();
  const title = data?.project.name ?? "";

  if (loading && !data) return <><Stack.Screen options={{ title, headerShown: true }} /><Loading /></>;
  if (!data) return <Screen onRefresh={refresh}><Stack.Screen options={{ title, headerShown: true }} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Screen>;

  const p = data.project;
  const links = Object.entries(p.links).filter(([, url]) => url);
  const statusNote = p.status === "paused" ? "・暫停中" : p.status === "done" ? "・已完成" : "";

  // 接下來：排程＋未完成里程碑，照日期排；左邊寫倒數
  const later = [
    ...data.events.map((e) => ({ key: `e${e.id}`, day: e.start_date, title: `${e.start_time ? `${e.start_time} ` : ""}${e.title}${e.end_date > e.start_date ? `（到 ${md(e.end_date)}）` : ""}`, milestone: false })),
    ...data.milestones.filter((m) => !m.done).map((m) => ({ key: `m${m.id}`, day: m.due, title: `◆ ${m.title}`, milestone: true })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: p.name, headerShown: false }} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      {/* 主角：整片光環漸層講目前階段＋下一步（顏色跟專案清單那塊磚一樣） */}
      <View style={{ marginTop: -insets.top, paddingTop: insets.top + 8, paddingHorizontal: 22, paddingBottom: 26, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, backgroundColor: "#1a1a1c", experimental_backgroundImage: haloAt(projectIndex(p.id), "72% 30%") }} accessibilityLabel={`${p.name}，目前階段 ${p.stages[p.stage_index] ?? ""}，下一步 ${p.next_step ?? "未設定"}`}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="回專案" hitSlop={6} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.42)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
          <SymbolView name="chevron.left" size={17} tintColor="#ffffff" weight="bold" />
        </Pressable>
        <Text accessibilityRole="header" style={{ fontSize: 27, fontWeight: "700", color: "#ffffff", marginTop: 18, lineHeight: 32 }}>{p.name}</Text>
        <Text style={{ fontSize: 22, fontWeight: "700", color: "rgba(255,255,255,0.76)", lineHeight: 28 }}>{`${p.stages[p.stage_index] ?? "—"}・第 ${p.stage_index + 1} 階段，共 ${p.stages.length}${statusNote}`}</Text>
        <View style={{ marginTop: 14 }}>
          <Progress total={p.stages.length} done={p.stage_index + 1} color="#ffffff" track="rgba(255,255,255,0.3)" />
        </View>
        <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)", marginTop: 20 }}>下一步</Text>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#ffffff", marginTop: 3, lineHeight: 27, textShadowColor: "rgba(0,0,0,0.3)", textShadowRadius: 10 }}>{p.next_step ?? "還沒設定下一步"}</Text>
      </View>

      {p.description ? <Text style={{ marginHorizontal: 22, marginTop: 14, fontSize: 14, lineHeight: 20, color: t.muted }}>{p.description}</Text> : null}

      <Section title="接下來">
        {later.length ? (
          later.map((it, i) => {
            const n = daysBetween(today, it.day);
            return (
              <Compact
                key={it.key}
                t={t}
                left={n < 0 ? "已過" : n <= 2 ? relDay(today, it.day) : `${+it.day.slice(5, 7)}/${+it.day.slice(8, 10)}`}
                leftStrong={n <= 1}
                leftColor={n < 0 ? t.danger : n <= 1 ? t.warn : undefined}
                title={it.title}
                right={it.milestone ? "里程碑" : undefined}
                last={i === later.length - 1}
              />
            );
          })
        ) : (
          <Empty text="接下來沒有排程或里程碑" />
        )}
      </Section>

      {links.length > 0 && (
        <View style={{ marginHorizontal: 20, marginTop: 22 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: t.muted, marginBottom: 8, marginLeft: 2 }}>連結</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {links.map(([k, url]) => (
              <Pressable key={k} onPress={() => WebBrowser.openBrowserAsync(url)} accessibilityRole="link" style={({ pressed }) => ({ height: 36, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "#0c0c0d", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: "#ffffff" }}>{LINK[k] ?? k}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* 日誌：最次要，字最小 */}
      <Section title="工作日誌">
        {data.logs.length ? (
          data.logs.slice(0, 15).map((l, i) => (
            <View key={l.id} style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 9, gap: 10, borderBottomWidth: i === Math.min(data.logs.length, 15) - 1 ? 0 : 1, borderBottomColor: t.sep }}>
              <Text style={{ width: 70, fontSize: 12, color: t.muted }}>{ago(l.at)}</Text>
              <Text style={{ flex: 1, fontSize: 14, color: t.text, lineHeight: 20 }}>{l.text}<Text style={{ color: t.faint }}>　{SOURCE[l.source] ?? l.source}</Text></Text>
            </View>
          ))
        ) : (
          <Empty text="還沒有紀錄" />
        )}
      </Section>
    </Screen>
  );
}
