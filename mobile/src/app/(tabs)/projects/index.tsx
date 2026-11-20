// 專案：進行中的每個專案一張卡（大字名稱、階段、進度條、下一步突出），暫停的縮成精簡列
import { router } from "expo-router";
import { Animated, Pressable, Text, View } from "react-native";
import { Compact, Progress } from "@/components/blocks";
import { Empty, ErrorNote, Loading, projectColor, Screen, Section } from "@/components/ui";
import { ago } from "@/lib/format";
import { useRise } from "@/lib/motion";
import { halo, useTheme } from "@/lib/theme";
import type { AppProject, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const open = (p: AppProject) => router.push({ pathname: "/projects/[slug]", params: { slug: p.slug } });

export default function Projects() {
  const t = useTheme();
  // 專案清單跟「今天」用同一份資料
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  if (loading && !data) return <Loading />;
  const active = (data?.projects ?? []).filter((p) => p.status === "active");
  const paused = (data?.projects ?? []).filter((p) => p.status === "paused");
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {active.length ? (
        <Text style={{ marginHorizontal: 22, marginTop: 2, fontSize: 22, color: t.muted, fontWeight: "700" }}>{active.length} 個進行中{paused.length ? `・${paused.length} 個暫停` : ""}</Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginHorizontal: 12, marginTop: 14 }}>
        {active.map((p, i) => <ProjectTile key={p.id} p={p} i={(data?.projects ?? []).indexOf(p)} wide={i === 0 || (active.length % 2 === 0 && i === active.length - 1)} />)}
      </View>
      {paused.length > 0 && (
        <Section title="暫停中">
          {paused.map((p, i) => (
            <Compact key={p.id} t={t} left={p.stage ?? "—"} title={p.name} titleWeight="500" right={`${ago(p.last_activity_at)}`} dot={projectColor(p.id)} onPress={() => open(p)} last={i === paused.length - 1} leftWidth={84} />
          ))}
        </Section>
      )}
      {data && !data.projects.length ? <Section><Empty text="還沒有專案，到 ideabox 網頁新增。" /></Section> : null}
    </Screen>
  );
}

/** 光環磚：專案名、階段、進度、下一步；第一個（最近有動靜的排在最前）佔一整排 */
function ProjectTile({ p, i, wide }: { p: AppProject; i: number; wide: boolean }) {
  const rise = useRise(i * 70);
  return (
    <Animated.View style={{ flexGrow: 1, flexBasis: wide ? "100%" : "48%", ...rise }}>
      <Pressable
        onPress={() => open(p)}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}，${p.stage ?? ""}，下一步 ${p.next_step ?? "未設定"}`}
        style={({ pressed }) => ({ minHeight: wide ? 150 : 206, borderRadius: 20, padding: 13, overflow: "hidden", backgroundColor: "#1a1a1c", experimental_backgroundImage: halo(i), opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: "800", color: "#ffffff" }} numberOfLines={1}>{p.name}</Text>
          {p.stage ? <Text style={{ fontSize: 12, fontWeight: "700", color: "#ffffff", maxWidth: wide ? 160 : 76 }} numberOfLines={1}>{p.stage} {p.stage_index + 1}/{p.stage_count}</Text> : null}
        </View>
        {p.stage_count > 0 ? <View style={{ marginTop: 9 }}><Progress total={p.stage_count} done={p.stage_index + 1} color="#ffffff" track="rgba(255,255,255,0.3)" /></View> : null}
        <Text style={{ fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.85)", marginTop: 14 }}>下一步</Text>
        <Text style={{ fontSize: wide ? 17 : 15, fontWeight: "700", color: "#ffffff", lineHeight: wide ? 23 : 20, marginTop: 2, textShadowColor: "rgba(0,0,0,0.3)", textShadowRadius: 8 }} numberOfLines={wide ? 2 : 4}>{p.next_step ?? "還沒設定下一步"}</Text>
        <View style={{ flex: 1, minHeight: 10 }} />
        <Text style={{ fontSize: 12, color: "#ffffff" }}>{ago(p.last_activity_at)}有動靜</Text>
      </Pressable>
    </Animated.View>
  );
}
