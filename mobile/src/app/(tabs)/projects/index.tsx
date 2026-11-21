// 專案：大字是最近有動靜的那個專案和它的下一步，其他專案在下面一列一個
import { router } from "expo-router";
import { View } from "react-native";
import { Icon } from "@/components/Icon";
import { Orb } from "@/components/Orb";
import { Bars, Big, Box, Dot, ErrorNote, Head, Label, Line, Loading, Page, projectColor, Small, Txt } from "@/components/ui";
import { daysBetween, taipeiToday } from "@/lib/format";
import { L } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { AppProject, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const open = (p: AppProject) => router.push({ pathname: "/projects/[slug]", params: { slug: p.slug } });
const stageText = (p: AppProject) => (p.stage ? `${p.stage} ${p.stage_index + 1}/${p.stage_count}` : "");

export default function Projects() {
  const t = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  if (loading && !data) return <Loading />;
  const today = taipeiToday();
  const active = (data?.projects ?? []).filter((p) => p.status === "active");
  const paused = (data?.projects ?? []).filter((p) => p.status === "paused");
  const [top, ...rest] = active;
  const quiet = (p: AppProject) => daysBetween(p.last_activity_at.slice(0, 10), today);

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head title={L("專案", "Projects")} pad={96} right={<Txt size={14} lh={20} muted tab>{L(`${active.length} 個進行中`, `${active.length} active`)}</Txt>} />
      <Orb size={136} mood="busy" style={{ position: "absolute", right: -36, top: 96 }} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}

      {top ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 40, marginRight: 96 }}>
            <Dot color={projectColor(top.id)} size={10} />
            <View style={{ flex: 1 }}><Big lines={1}>{top.name}</Big></View>
          </View>
          {top.stage ? <Txt muted tab style={{ marginTop: 8 }}>{`${top.stage}，${top.stage_index + 1}/${top.stage_count}`}</Txt> : null}
          {top.stage_count > 0 ? <Bars done={top.stage_index + 1} total={top.stage_count} /> : null}
          <Box onPress={() => open(top)} label={L(`${top.name}，下一步 ${top.next_step ?? "還沒設定"}`, `${top.name}, next: ${top.next_step ?? "not set"}`)} style={{ marginTop: 24, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Txt size={14} lh={20} muted>{L("下一步", "Next")}</Txt>
              <Txt size={20} lh={28} style={{ marginTop: 4 }} numberOfLines={3}>{top.next_step ?? L("還沒設定", "Not set")}</Txt>
            </View>
            <Icon name="chev" size={18} color={t.muted} />
          </Box>
        </>
      ) : data ? (
        <View style={{ marginTop: 40, marginRight: 96 }}>
          <Big>{L("還沒有專案", "No projects yet")}</Big>
          <Txt muted style={{ marginTop: 8 }}>{L("到 ideabox 網頁新增", "Add one on the ideabox website")}</Txt>
        </View>
      ) : null}

      {rest.length ? (
        <View style={{ marginTop: 24 }}>
          {rest.map((p, i) => {
            const d = quiet(p);
            return (
              <Line key={p.id} last={i === rest.length - 1} onPress={() => open(p)} style={{ opacity: d >= 5 ? 0.6 : 1 }}>
                <Dot color={projectColor(p.id)} />
                <Txt style={{ flex: 1 }} numberOfLines={1}>{p.name}</Txt>
                {d >= 5 ? <Small icon="moon" iconLabel={L("沒動靜", "Quiet for")}>{L(`${d} 天`, `${d}d`)}</Small> : <Small>{stageText(p)}</Small>}
              </Line>
            );
          })}
        </View>
      ) : null}

      {paused.length ? (
        <>
          <Label icon="moon">{L("暫停中", "Paused")}</Label>
          {paused.map((p, i) => (
            <Line key={p.id} last={i === paused.length - 1} onPress={() => open(p)} style={{ opacity: 0.6 }}>
              <Dot color={projectColor(p.id)} />
              <Txt style={{ flex: 1 }} numberOfLines={1}>{p.name}</Txt>
              <Small>{p.stage ?? ""}</Small>
            </Line>
          ))}
        </>
      ) : null}
    </Page>
  );
}
