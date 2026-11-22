// 專案（2.4 柔和卡片版）：一個專案一張卡片——名稱、階段、下一步、進度條、幾件過期或待辦；點了進詳細頁。
// 暫停中的排在最下面、淡一點。
import { router } from "expo-router";
import { View } from "react-native";
import { Card, Dot, Empty, ErrorNote, Head, Loading, Page, Progress, projectColor, Sec, Tag, Txt } from "@/components/ui";
import { daysBetween, taipeiToday } from "@/lib/format";
import { L } from "@/lib/i18n";
import type { AppProject, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const open = (p: AppProject) => router.push({ pathname: "/projects/[slug]", params: { slug: p.slug } });

export default function Projects() {
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  if (loading && !data) return <Loading />;
  const active = (data?.projects ?? []).filter((p) => p.status === "active");
  const paused = (data?.projects ?? []).filter((p) => p.status === "paused");
  const today = taipeiToday();
  const overdue = data?.overdue ?? 0;

  const card = (p: AppProject, dim?: boolean) => {
    const c = data?.todo?.[p.id];
    const quiet = daysBetween(p.last_activity_at.slice(0, 10), today);
    return (
      <Card key={p.id} onPress={() => open(p)} label={`${p.name}，${p.stage ?? ""}，${L("下一步", "next")} ${p.next_step ?? L("還沒設定", "not set")}`} style={{ opacity: dim ? 0.6 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Dot color={projectColor(p.id)} />
          <Txt med size={16} lh={22} numberOfLines={1} style={{ flex: 1 }}>{p.name}</Txt>
          {p.stage ? <Tag>{p.stage}</Tag> : null}
          {p.stage_count ? <Txt num size={13} lh={18} muted>{p.stage_index + 1}/{p.stage_count}</Txt> : null}
        </View>
        <Txt size={13.5} lh={20} muted numberOfLines={2} style={{ marginTop: 6 }}>
          {L("下一步", "Next")}　<Txt size={13.5} lh={20}>{p.next_step ?? L("還沒設定", "Not set")}</Txt>
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
          <View style={{ flex: 1 }}><Progress frac={p.stage_count ? (p.stage_index + 1) / p.stage_count : 0} top={0} /></View>
          {c?.late ? <Tag tone="bad">{L(`${c.late} 件過期`, `${c.late} overdue`)}</Tag> : c?.open ? <Tag>{L(`待辦 ${c.open}`, `${c.open} to-dos`)}</Tag> : !dim && quiet >= 5 ? <Tag>{L(`${quiet} 天沒動`, `quiet ${quiet}d`)}</Tag> : null}
        </View>
      </Card>
    );
  };

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head title={L("專案", "Projects")} sub={L(`${active.length} 個進行中`, `${active.length} active`)} right={overdue > 0 ? <Tag tone="bad" big>{L(`${overdue} 件過期`, `${overdue} overdue`)}</Tag> : undefined} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      <View style={{ marginTop: 6 }}>{active.map((p) => card(p))}</View>
      {data && !active.length && !paused.length ? <Empty text={L("還沒有專案，到 ideabox 網頁新增。", "No projects yet. Add one on the ideabox website.")} /> : null}
      {paused.length ? (
        <>
          <Sec>{L("暫停中", "Paused")}</Sec>
          {paused.map((p) => card(p, true))}
        </>
      ) : null}
    </Page>
  );
}
