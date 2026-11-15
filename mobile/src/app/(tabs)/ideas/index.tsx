// 點子：每則左邊一個大分數徽章（最先看到值不值得做），標題粗體，下一步用主色箭頭；已採用的用淡色底卡片突顯
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { soft } from "@/components/blocks";
import { Card, Empty, ErrorNote, Loading, Screen, Section } from "@/components/ui";
import { ago } from "@/lib/format";
import { useTheme, type Palette } from "@/lib/theme";
import type { Idea, IdeasData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const scoreColor = (t: Palette, s: number | null) => (s == null ? t.faint : s >= 8 ? t.ok : s >= 6 ? t.accent : t.muted);

export default function Ideas() {
  const t = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi<IdeasData>("/api/app/ideas");
  const [cat, setCat] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  const ideas = data?.ideas ?? [];
  const cats = [...new Set(ideas.map((i) => i.category).filter(Boolean))] as string[];
  const shown = cat ? ideas.filter((i) => i.category === cat) : ideas;
  const adopted = shown.filter((i) => i.adopted);
  const rest = shown.filter((i) => !i.adopted);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {cats.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingTop: 6, paddingBottom: 6 }}>
          {[null, ...cats].map((c) => (
            <Pressable key={c ?? "all"} onPress={() => setCat(c)} accessibilityRole="tab" accessibilityState={{ selected: cat === c }} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: t.radiusSm, borderWidth: t.borderWidth, borderColor: cat === c ? t.ink : t.border, backgroundColor: cat === c ? t.ink : t.card }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: cat === c ? t.inkText : t.text }}>{c ?? "全部"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {adopted.length > 0 && (
        <>
          <Text style={{ marginHorizontal: 20, marginTop: 18, fontSize: 13, fontWeight: "700", color: t.muted }}>已採用・{adopted.length}</Text>
          {adopted.map((i) => (
            <Card key={i.id} style={{ marginHorizontal: 16, marginTop: 8, backgroundColor: soft(t.ok, 0.1), borderColor: soft(t.ok, 0.3) }}>
              <IdeaRow i={i} t={t} last />
            </Card>
          ))}
        </>
      )}

      <Section title={`${adopted.length ? "其他點子" : "最近的點子"}・${rest.length}`} footer="App 只能看。要新增點子，直接傳給 Telegram Bot。">
        {rest.length ? rest.map((i, n) => <IdeaRow key={i.id} i={i} t={t} last={n === rest.length - 1} />) : <Empty text="沒有點子" />}
      </Section>
    </Screen>
  );
}

function IdeaRow({ i, t, last }: { i: Idea; t: Palette; last: boolean }) {
  const c = scoreColor(t, i.score);
  const body = (
    <View style={{ flexDirection: "row", paddingLeft: 14, gap: 12 }}>
      {/* 分數徽章：最先看到 */}
      <View style={{ width: 46, height: 46, borderRadius: 14, marginTop: 12, backgroundColor: soft(c.startsWith("#") ? c : "#888888", 0.14), alignItems: "center", justifyContent: "center" }} accessibilityLabel={i.score != null ? `分數 ${i.score}` : "還沒評分"}>
        <Text style={{ fontSize: 18, fontWeight: "900", color: c, fontVariant: ["tabular-nums"] }}>{i.score ?? "—"}</Text>
      </View>
      <View style={{ flex: 1, paddingVertical: 12, paddingRight: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.sep }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: t.text, lineHeight: 22 }} numberOfLines={2}>{i.title || "（沒有標題）"}</Text>
        {i.next_step ? (
          <Text style={{ fontSize: 14, color: t.text, marginTop: 4, lineHeight: 20 }} numberOfLines={2}>
            <Text style={{ color: t.accent, fontWeight: "800" }}>→ </Text>
            {i.next_step}
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, color: t.muted, marginTop: 5 }} numberOfLines={1}>{[i.category, i.project, ago(i.created_at)].filter(Boolean).join("・")}</Text>
      </View>
    </View>
  );
  return i.url ? (
    <Pressable onPress={() => WebBrowser.openBrowserAsync(i.url!)} accessibilityRole="link" style={({ pressed }) => pressed && { backgroundColor: t.cardPressed }}>
      {body}
    </Pressable>
  ) : (
    body
  );
}
