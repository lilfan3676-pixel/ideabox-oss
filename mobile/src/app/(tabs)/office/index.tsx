// 辦公室：每個有資料夾的專案一間房間＋大廳，房間裡是正在幫你做事的 Claude（同專案同職位＝同一個人）
// 跟網頁手機版一樣：一次看一間（上面點專案標籤切換），一開始停在有人在工作的房間；畫面開著每 5 秒更新
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { OfficeRoom } from "@/components/OfficeRoom";
import { DayHeading, Hero, soft } from "@/components/blocks";
import { Card, Empty, ErrorNote, Loading, projectColor, Screen, Section } from "@/components/ui";
import { useTheme, type Palette } from "@/lib/theme";
import type { OfficeData, OfficePerson, OfficeStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** 職位顏色（跟網頁辦公室小人的衣服一樣） */
const ROLE_COLOR: Record<string, string> = {
  前端工程師: "#4f8cff",
  後端工程師: "#22c55e",
  資料庫工程師: "#f59e0b",
  "App 工程師": "#a855f7",
  設計師: "#ec4899",
  文案企劃: "#f97316",
  測試工程師: "#14b8a6",
  維運工程師: "#64748b",
  產品經理: "#ef4444",
  研究員: "#eab308",
  法律顧問: "#1e3a8a",
  財務會計: "#0d9488",
  行銷社群: "#d946ef",
  業務營運: "#b45309",
};

const STATUS_LABEL: Record<OfficeStatus, string> = { working: "工作中", waiting: "等你回覆", permission: "等你同意", idle: "休息中", ended: "下班" };
const RANK: Record<OfficeStatus, number> = { working: 0, permission: 1, waiting: 2, idle: 3, ended: 4 };
const needsYou = (s: OfficeStatus) => s === "waiting" || s === "permission";

function statusColor(t: Palette, s: OfficeStatus) {
  if (s === "working") return t.ok;
  if (needsYou(s)) return t.warn;
  return t.muted;
}

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  if (m < 1440) return `${Math.floor(m / 60)} 小時前`;
  return `${Math.floor(m / 1440)} 天前`;
}

export default function Office() {
  const t = useTheme();
  const { width: screenW } = useWindowDimensions();
  const { data, error, loading, refreshing, refresh } = useApi<OfficeData>("/api/app/office", { pollMs: 5_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const first = data ? firstRoom(data) : null;
  // 一開始停在有人在工作的房間，定下來之後輪詢不會自己換房間
  useEffect(() => {
    if (!picked && first) setPicked(first);
  }, [picked, first]);
  if (loading && !data) return <Loading />;
  if (!data) return <Screen onRefresh={refresh}>{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Screen>;

  const inRoom = (id: string) => data.people.filter((p) => p.room === id);
  const rooms = visibleRooms(data);
  const active = picked && rooms.some((r) => r.id === picked) ? picked : first;
  const room = rooms.find((r) => r.id === active);

  const working = data.people.filter((p) => p.status === "working").length;
  const waiting = data.people.filter((p) => needsYou(p.status)).length;
  const onDuty = data.people.filter((p) => p.status !== "ended").length;

  const people = room ? [...inRoom(room.id)].sort((a, b) => RANK[a.status] - RANK[b.status] || b.updated_at.localeCompare(a.updated_at)) : [];
  const on = people.filter((p) => p.status !== "ended");
  const off = people.filter((p) => p.status === "ended");

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {!data.ready ? <ErrorNote text="辦公室還沒準備好：ideabox 的資料庫要先執行 migration-014。" /> : null}

      {/* 主角：有人在等你就講誰在等；沒有就講幾個人在工作 */}
      {waiting ? (
        <Hero
          kicker="在等你"
          big={String(waiting)}
          title="個 Claude 在等你回覆"
          sub={data.people
            .filter((p) => needsYou(p.status))
            .slice(0, 3)
            .map((p) => `${roomName(data, p.room)}・${p.role ?? "待分配"}${p.task ? `：${p.task}` : ""}`)
            .join("\n")}
          color={t.warn}
          a11y={`${waiting} 個 Claude 在等你回覆`}
        />
      ) : working ? (
        <Hero kicker="辦公室" big={String(working)} title="個 Claude 在工作" sub={`在辦公室 ${onDuty} 人・沒有人在等你`} tone="soft" color={t.ok} />
      ) : (
        <Hero kicker="辦公室" title={onDuty ? "大家在休息" : "大家都下班了"} sub={onDuty ? `${onDuty} 人在辦公室，沒有人在工作` : "有新的 Claude Code 開始工作就會出現在這裡"} tone="soft" color={t.muted} />
      )}
      <Text style={{ marginHorizontal: 20, marginTop: 10, fontSize: 13, color: t.muted, fontWeight: "600" }}>
        工作中 {working}・在等你 {waiting}・在辦公室 {onDuty}
      </Text>

      {rooms.length === 0 ? (
        <Section>
          <Empty text="還沒有房間。到網頁的專案設定填「資料夾名稱」，那個資料夾裡的 Claude Code 就會出現在這裡。" />
        </Section>
      ) : (
        <>
          {/* 專案標籤：綠點＝有人在工作、橘點＝在等你 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingTop: 16, paddingBottom: 6 }}>
            {rooms.map((r) => {
              const list = inRoom(r.id);
              const busy = list.some((p) => p.status === "working");
              const wait = list.some((p) => needsYou(p.status));
              const sel = r.id === active;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setPicked(r.id);
                    setShowOff(false);
                    Haptics.selectionAsync();
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`${r.name}${wait ? "，有人在等你" : busy ? "，有人在工作" : ""}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: t.radiusSm,
                    borderWidth: t.borderWidth,
                    borderColor: sel ? t.ink : t.border,
                    backgroundColor: sel ? t.ink : t.card,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: t.name === "portal" ? 0 : 4, backgroundColor: r.id === "lobby" ? "#94a3b8" : projectColor(r.id) }} />
                  <Text style={{ fontSize: 15, fontWeight: "700", color: sel ? t.inkText : t.text }}>{r.name}</Text>
                  {wait || busy ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: wait ? t.warn : t.ok }} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {room ? (
            <Card style={{ marginHorizontal: 16, marginTop: 10, overflow: "hidden", backgroundColor: "#1b1730" }}>
              <OfficeRoom title={room.name} color={room.id === "lobby" ? "#94a3b8" : projectColor(room.id)} people={people} now={data.now} width={screenW - 32} />
            </Card>
          ) : null}

          {room ? <DayHeading t={t} day={room.name} chip={room.stage ? `${room.stage}・上班 ${on.length} 人` : `上班 ${on.length} 人`} /> : null}
          {room ? (
            <Section>
              {on.length ? on.map((p, i) => <Person key={p.key} p={p} t={t} now={data.now} lobby={room.id === "lobby"} last={i === on.length - 1 && !off.length} />) : <Empty text="現在沒有人在上班" />}
              {off.length > 0 && (
                <>
                  <Pressable onPress={() => setShowOff((v) => !v)} accessibilityRole="button" style={{ paddingHorizontal: 16, paddingVertical: 13 }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: t.muted }}>{`${showOff ? "▾" : "▸"} 已下班 ${off.length} 人`}</Text>
                  </Pressable>
                  {showOff ? off.map((p, i) => <Person key={p.key} p={p} t={t} now={data.now} lobby={room.id === "lobby"} last={i === off.length - 1} />) : null}
                </>
              )}
            </Section>
          ) : null}
          <Text style={{ fontSize: 13, color: t.muted, marginHorizontal: 20, marginTop: 8, lineHeight: 18 }}>每 5 秒自動更新。要手動指定職位請到網頁的辦公室。</Text>
        </>
      )}
    </Screen>
  );
}

const roomName = (d: OfficeData, id: string) => d.rooms.find((r) => r.id === id)?.name ?? "大廳";

/** 大廳沒人就不顯示 */
function visibleRooms(d: OfficeData) {
  return d.rooms.filter((r) => r.id !== "lobby" || d.people.some((p) => p.room === "lobby"));
}

function firstRoom(d: OfficeData): string | null {
  const rooms = visibleRooms(d);
  const has = (id: string, ok: (p: OfficePerson) => boolean) => d.people.some((p) => p.room === id && ok(p));
  return (rooms.find((r) => has(r.id, (p) => p.status === "working")) ?? rooms.find((r) => has(r.id, (p) => p.status !== "ended")) ?? rooms[0])?.id ?? null;
}


/** 一個人：職位色的頭像、職位、狀態、在做的事 */
function Person({ p, t, now, lobby, last }: { p: OfficePerson; t: Palette; now: number; lobby: boolean; last: boolean }) {
  const role = p.role ?? "待分配";
  const color = (p.role && ROLE_COLOR[p.role]) || "#94a3b8";
  const offDuty = p.status === "ended";
  const sub = [offDuty ? `待機中・${ago(p.updated_at, now)}` : p.task, lobby && p.folder ? `📁 ${p.folder}` : null, p.sessions > 1 ? `${p.sessions} 個對話` : null].filter(Boolean).join("・");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 16, opacity: offDuty ? 0.55 : 1, backgroundColor: needsYou(p.status) ? soft(t.warn, 0.12) : undefined }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: t.name === "portal" ? 0 : 18,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
          marginRight: 12,
          boxShadow: t.name === "portal" ? `2px 2px 0px ${t.pop}` : undefined,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "800" }}>{needsYou(p.status) ? "?" : role.replace("App ", "A").slice(0, 1)}</Text>
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingRight: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.sep }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: offDuty ? 15 : 16, fontWeight: offDuty ? "600" : "800", color: t.text }}>{role}</Text>
          {/* 在做的事是重點：工作中／等你的用深色，下班的才用淡色 */}
          {sub ? <Text style={{ fontSize: 14, color: offDuty ? t.muted : t.text, marginTop: 2, lineHeight: 19 }} numberOfLines={2}>{sub}</Text> : null}
        </View>
        {!offDuty ? (
          <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: t.radiusSm, backgroundColor: soft(statusColor(t, p.status), 0.14) }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: statusColor(t, p.status) }}>{STATUS_LABEL[p.status]}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
