// 辦公室：上班中的 Claude 一人一顆小球，浮在上半頁（越要緊越大：等你的 > 工作中 > 休息）。
// 選到的那顆最大、有外圈，下面講他是誰、在做什麼；左右滑或點別顆換人。
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, LayoutAnimation, Pressable, useWindowDimensions, View } from "react-native";
import { Icon } from "@/components/Icon";
import { Orb } from "@/components/Orb";
import { Big, Box, Empty, ErrorNote, Head, Line, Loading, Page, Txt } from "@/components/ui";
import { ago } from "@/lib/format";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useSwipe } from "@/lib/swipe";
import { useTheme } from "@/lib/theme";
import type { OfficeData, OfficePerson, OfficeStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const RANK: Record<OfficeStatus, number> = { permission: 0, waiting: 1, working: 2, idle: 3, ended: 4 };
const needsYou = (s: OfficeStatus) => s === "waiting" || s === "permission";
const statusText = (s: OfficeStatus) => ({ working: L("工作中", "Working"), waiting: L("在等你回覆", "Waiting for you"), permission: L("在等你同意", "Needs your OK"), idle: L("休息中", "Resting"), ended: L("下班", "Off") })[s];

// 小球浮在哪裡：[中心 x（佔寬度的比例）, 中心 y]。第 0 個位置給選到的那顆
const SLOTS: [number, number][] = [[0.3, 140], [0.68, 76], [0.76, 214], [0.47, 276], [0.14, 276], [0.92, 140]];
const AREA = 330;

/** 慢慢上下飄；每顆的節奏不一樣 */
function Floaty({ i, children }: { i: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion()) return;
    const d = 2400 + (i % 4) * 420;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: d, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: d, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [v, i]);
  return <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] }) }] }}>{children}</Animated.View>;
}

export default function Office() {
  const t = useTheme();
  const { width: W } = useWindowDimensions();
  const { data, error, loading, refreshing, refresh } = useApi<OfficeData>("/api/app/office", { pollMs: 5_000 });
  const [showOff, setShowOff] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // 選到誰（key）
  const sorted = [...(data?.people ?? [])].sort((a, b) => RANK[a.status] - RANK[b.status] || b.updated_at.localeCompare(a.updated_at));
  const on = sorted.filter((p) => p.status !== "ended").slice(0, SLOTS.length);
  const index = Math.max(0, on.findIndex((p) => p.key === picked));
  const pick = (key: string | null) => {
    if (!reduceMotion()) LayoutAnimation.configureNext({ duration: 320, update: { type: "spring", springDamping: 0.82 } });
    setPicked(key);
  };
  const swipe = useSwipe(on.length, index, (i) => pick(on[i]?.key ?? null));
  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}><Head title={L("辦公室", "Office")} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const room = (id: string) => data.rooms.find((r) => r.id === id)?.name ?? L("大廳", "Lobby");
  const off = sorted.filter((p) => p.status === "ended");
  const working = on.filter((p) => p.status === "working").length;
  const role = (p: OfficePerson) => p.role ?? L("待分配", "Unassigned");
  const now = data.now;
  const cur = on[index];
  // 選到的排第一個位置，其他照原本的順序排後面的位置
  const placed = cur ? [cur, ...on.filter((p) => p.key !== cur.key)] : [];
  const sizeOf = (p: OfficePerson, sel: boolean) => (sel ? 132 : needsYou(p.status) ? 92 : p.status === "working" ? 76 : 52);
  const moodOf = (p: OfficePerson) => (needsYou(p.status) ? "curious" : p.status === "working" ? "busy" : "sleep") as "curious" | "busy" | "sleep";

  return (
    <Page refreshing={refreshing} onRefresh={refresh} swiping={swipe.dragging}>
      <View {...swipe.handlers}>
        <Head title={L("辦公室", "Office")} right={<><Icon name="activity" size={14} color={t.muted} /><Txt size={14} lh={20} muted tab>{L(`${working} 個在工作`, `${working} working`)}</Txt></>} />
        {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
        {!data.ready ? <ErrorNote text={L("辦公室還沒準備好：ideabox 的資料庫要先執行 migration-014。", "Office isn't ready: run migration-014 first.")} /> : null}

        {cur ? (
          <>
            <View style={{ height: AREA, marginHorizontal: -28, marginTop: 8 }}>
              {placed.map((p, i) => {
                const sel = i === 0;
                const size = sizeOf(p, sel);
                const [fx, cy] = SLOTS[i];
                const pad = sel ? 7 : 0;
                return (
                  <View key={p.key} style={{ position: "absolute", left: W * fx - size / 2 - pad, top: cy - size / 2 - pad, alignItems: "center" }}>
                    <Floaty i={i}>
                      <Pressable
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => null);
                          pick(p.key);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        accessibilityLabel={`${role(p)}，${statusText(p.status)}`}
                        hitSlop={size < 60 ? 8 : 0}
                        style={{ alignItems: "center" }}
                      >
                        <View style={{ padding: pad, borderRadius: size, borderWidth: sel ? 1.5 : 0, borderColor: t.ink }}>
                          <Orb size={size} mood={moodOf(p)} shadow={false} />
                        </View>
                        <Txt size={12} lh={16} color={sel ? t.ink : t.muted} numberOfLines={1} style={{ marginTop: 6, maxWidth: 110 }}>{role(p)}</Txt>
                      </Pressable>
                    </Floaty>
                  </View>
                );
              })}
            </View>

            <Animated.View style={swipe.style} accessibilityHint={L("左右滑換下一個人", "Swipe sideways for the next one")}>
              <Big size={32} lines={2}>{`${role(cur)}${L("", " ")}${statusText(cur.status)}`}</Big>
              <Txt muted tab style={{ marginTop: 8 }}>{`${room(cur.room)}，${ago(cur.updated_at, now)}`}</Txt>
              <Box style={{ marginTop: 20, minHeight: 84 }}>
                <Txt size={14} lh={20} muted>{L("在做", "Working on")}</Txt>
                <Txt size={20} lh={28} style={{ marginTop: 4 }} numberOfLines={3}>{cur.task ?? L("沒有在做的事", "Nothing right now")}</Txt>
              </Box>
              {on.length > 1 ? <Txt size={13} lh={20} muted tab style={{ marginTop: 12 }}>{`${index + 1} / ${on.length}`}</Txt> : null}
            </Animated.View>
          </>
        ) : (
          <View style={{ marginTop: 40 }}>
            <Big>{off.length ? L("都下班了", "Everyone is off") : L("還沒有人", "Nobody yet")}</Big>
            {off.length ? null : <Empty text={L("到網頁的專案設定填資料夾名稱，那個資料夾裡的 Claude Code 就會出現在這裡。", "Set a folder name in a project's web settings and its Claude Code sessions show up here.")} />}
          </View>
        )}
      </View>

      {off.length ? (
        <View style={{ marginTop: 20 }}>
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
        </View>
      ) : null}
    </Page>
  );
}
