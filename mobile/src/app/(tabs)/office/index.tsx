// 辦公室：每個上班中的 Claude 是一顆小球（等你的最大、好奇的表情；工作中的在忙；休息的睡了）。
// 大字只講最要緊的：有誰在等你回覆。下面一人一列，右邊圖示＝沙漏在等你、波形工作中、月亮休息
import { useState } from "react";
import { View } from "react-native";
import { Icon } from "@/components/Icon";
import { Orb } from "@/components/Orb";
import { Big, Empty, ErrorNote, Head, Line, Loading, Page, Txt } from "@/components/ui";
import { ago } from "@/lib/format";
import { L } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { OfficeData, OfficePerson, OfficeStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const RANK: Record<OfficeStatus, number> = { permission: 0, waiting: 1, working: 2, idle: 3, ended: 4 };
const needsYou = (s: OfficeStatus) => s === "waiting" || s === "permission";
const statusText = (s: OfficeStatus) => ({ working: L("工作中", "Working"), waiting: L("在等你回覆", "Waiting for you"), permission: L("在等你同意", "Needs your OK"), idle: L("休息中", "Resting"), ended: L("下班", "Off") })[s];

export default function Office() {
  const t = useTheme();
  const { data, error, loading, refreshing, refresh } = useApi<OfficeData>("/api/app/office", { pollMs: 5_000 });
  const [showOff, setShowOff] = useState(false);
  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}><Head title={L("辦公室", "Office")} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const room = (id: string) => data.rooms.find((r) => r.id === id)?.name ?? L("大廳", "Lobby");
  const sorted = [...data.people].sort((a, b) => RANK[a.status] - RANK[b.status] || b.updated_at.localeCompare(a.updated_at));
  const on = sorted.filter((p) => p.status !== "ended");
  const off = sorted.filter((p) => p.status === "ended");
  const working = on.filter((p) => p.status === "working").length;
  const waiting = on.filter((p) => needsYou(p.status));
  const lead = waiting[0];
  const role = (p: OfficePerson) => p.role ?? L("待分配", "Unassigned");
  const now = data.now;

  return (
    <Page refreshing={refreshing} onRefresh={refresh}>
      <Head title={L("辦公室", "Office")} right={<><Icon name="activity" size={14} color={t.muted} /><Txt size={14} lh={20} muted tab>{L(`${working} 個在工作`, `${working} working`)}</Txt></>} />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {!data.ready ? <ErrorNote text={L("辦公室還沒準備好：ideabox 的資料庫要先執行 migration-014。", "Office isn't ready: run migration-014 first.")} /> : null}

      <View style={{ marginTop: 40 }}>
        {lead ? (
          <>
            <Big lines={3}>{`${role(lead)}\n${statusText(lead.status)}`}</Big>
            <Txt muted tab style={{ marginTop: 8 }}>{`${room(lead.room)}，${ago(lead.updated_at, now)}`}{waiting.length > 1 ? L(`，另外還有 ${waiting.length - 1} 個`, `, +${waiting.length - 1} more`) : ""}</Txt>
          </>
        ) : (
          <>
            <Big>{working ? L(`${working} 個在工作`, `${working} working`) : on.length ? L("大家在休息", "Everyone is resting") : L("都下班了", "Everyone is off")}</Big>
            <Txt muted style={{ marginTop: 8 }}>{L("沒有人在等你", "Nobody is waiting for you")}</Txt>
          </>
        )}
      </View>

      {on.length ? (
        <View style={{ marginTop: 28, flexDirection: "row", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {on.slice(0, 6).map((p) => (
            <Orb key={p.key} size={needsYou(p.status) ? 88 : p.status === "working" ? 56 : 44} mood={needsYou(p.status) ? "curious" : p.status === "working" ? "busy" : "sleep"} shadow={false} label={`${role(p)}，${statusText(p.status)}`} />
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        {on.map((p, i) => (
          <Line key={p.key} h={60} last={i === on.length - 1 && !off.length} style={{ opacity: p.status === "idle" ? 0.6 : 1 }}>
            <View style={{ flex: 1 }}>
              <Txt lh={22}>{role(p)}</Txt>
              <Txt size={13} lh={18} muted numberOfLines={2}>{[room(p.room), p.task, p.sessions > 1 ? L(`${p.sessions} 個對話`, `${p.sessions} sessions`) : null].filter(Boolean).join("　")}</Txt>
            </View>
            <Icon name={needsYou(p.status) ? "wait" : p.status === "working" ? "activity" : "moon"} size={18} color={needsYou(p.status) ? t.ink : t.muted} label={statusText(p.status)} />
          </Line>
        ))}
        {!on.length && !off.length ? <Empty text={L("還沒有人。到網頁的專案設定填資料夾名稱，那個資料夾裡的 Claude Code 就會出現在這裡。", "Nobody yet. Set a folder name in a project's web settings and its Claude Code sessions show up here.")} /> : null}
        {off.length ? (
          <>
            <Line last={!showOff} onPress={() => setShowOff((v) => !v)}>
              <Txt size={14} muted style={{ flex: 1 }}>{L(`已下班 ${off.length} 人`, `${off.length} off duty`)}</Txt>
              <View style={{ transform: [{ rotate: showOff ? "90deg" : "0deg" }] }}><Icon name="chev" size={16} color={t.muted} /></View>
            </Line>
            {showOff
              ? off.map((p, i) => (
                  <Line key={p.key} last={i === off.length - 1} style={{ opacity: 0.6 }}>
                    <Txt style={{ flex: 1 }} numberOfLines={1}>{role(p)}</Txt>
                    <Txt size={13} muted tab>{`${room(p.room)}　${ago(p.updated_at, now)}`}</Txt>
                  </Line>
                ))
              : null}
          </>
        ) : null}
      </View>
    </Page>
  );
}
