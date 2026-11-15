// 專案：進行中的每個專案一張卡（大字名稱、階段、進度條、下一步突出），暫停的縮成精簡列
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Compact, Progress, soft } from "@/components/blocks";
import { Card, Empty, ErrorNote, Loading, projectColor, Screen, Section } from "@/components/ui";
import { ago } from "@/lib/format";
import { useTheme, type Palette } from "@/lib/theme";
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
        <Text style={{ marginHorizontal: 20, marginTop: 4, fontSize: 15, color: t.muted, fontWeight: "600" }}>{active.length} 個進行中{paused.length ? `・${paused.length} 個暫停` : ""}</Text>
      ) : null}
      {active.map((p) => <ProjectCard key={p.id} p={p} t={t} />)}
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

function ProjectCard({ p, t }: { p: AppProject; t: Palette }) {
  const color = projectColor(p.id);
  return (
    <Pressable onPress={() => open(p)} accessibilityRole="button" accessibilityLabel={`${p.name}，${p.stage ?? ""}，下一步 ${p.next_step ?? "未設定"}`} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
          <Text style={{ flex: 1, fontSize: 21, fontWeight: "800", color: t.text }} numberOfLines={1}>{p.name}</Text>
          {p.stage ? (
            <View style={{ backgroundColor: soft(color, 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "800", color: t.text }}>{p.stage}　{p.stage_index + 1}/{p.stage_count}</Text>
            </View>
          ) : null}
          <Text style={{ fontSize: 20, color: t.faint, marginTop: -2 }}>›</Text>
        </View>
        {p.stage_count > 0 ? <Progress total={p.stage_count} done={p.stage_index + 1} color={color} track={t.accentSoft} /> : null}
        <View>
          <Text style={{ fontSize: 12, fontWeight: "700", color: t.muted }}>下一步</Text>
          <Text style={{ fontSize: 16, fontWeight: "700", color: p.next_step ? t.text : t.faint, marginTop: 2, lineHeight: 22 }} numberOfLines={3}>{p.next_step ?? "還沒設定下一步"}</Text>
        </View>
        <Text style={{ fontSize: 12, color: t.muted }}>{ago(p.last_activity_at)}有動靜</Text>
      </Card>
    </Pressable>
  );
}
