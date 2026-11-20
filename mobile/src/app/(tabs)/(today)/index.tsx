// 今天（App 2.0 的 B 版）：整面暖色漸層，一顆大球，一次講一件事。
// 一天有很多件事：左右滑（或按兩邊箭頭）換上一件／下一件，底下的圓弧是今天的時間軸，一件事一個點；
// 按底部中間的膠囊拉出清單，看今天全部、接下來、進行中的專案。
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, PanResponder, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { ErrorNote, Loading, projectColor } from "@/components/ui";
import { setSheet, useSheet } from "@/lib/dock";
import { reduceMotion, SPRING, usePresence } from "@/lib/motion";
import { SKIES, skyKeyAt, STARS, type Sky, type SkyKey } from "@/lib/sky";
import { addDays, daysBetween, md, pastBy, relDay, taipeiHm, weekday } from "@/lib/format";
import { getSession } from "@/lib/session";
import type { AppEvent, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** 合夥人的手機沒有這個畫面就不跳過去（舊的配對沒有 tabs＝全部都有） */
const canSee = (tab: string) => {
  const tabs = getSession()?.tabs;
  return !tabs || tabs.includes(tab);
};

// 月亮：NASA 戈達德太空飛行中心用月球勘測軌道飛行器（LRO）資料做的滿月圖（images.nasa.gov，GSFC_20171208_Archive_e000868，公共領域），裁成去背的圓
const MOON = require("../../../../assets/moon.png");
const DIM = "rgba(255,255,255,0.62)";
const SOFT = "rgba(255,255,255,0.76)";

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

/** 「2 小時後」「35 分鐘後」 */
function until(nowHm: string, at: string): string {
  const m = toMin(at) - toMin(nowHm);
  if (m <= 0) return "進行中";
  if (m < 60) return `${m} 分鐘後`;
  const h = Math.floor(m / 60);
  return m % 60 >= 30 ? `${h} 個半小時後` : `${h} 小時後`;
}

/** 有時間的事過了 30 分鐘算做完（整天的事不會自己完成） */
const isPast = (e: AppEvent, nowHm: string) => pastBy(e.start_time, nowHm);

/** 預設講哪一件：接下來有時間的 → 整天的 → 都過了就最後一件 */
function defaultIndex(events: AppEvent[], nowHm: string): number {
  const next = events.findIndex((e) => e.start_time && !isPast(e, nowHm));
  if (next >= 0) return next;
  const allDay = events.findIndex((e) => !e.start_time);
  return allDay >= 0 ? allDay : Math.max(0, events.length - 1);
}

/** 圓弧上的位置：06:00 在最左、24:00 在最右 */
const arcT = (hm: string) => 0.08 + 0.84 * Math.min(1, Math.max(0, (toMin(hm) - 360) / 1080));

export default function Today() {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  const sheet = useSheet();
  const [picked, setPicked] = useState<string | null>(null); // 使用者滑到哪一件（事件 id）
  useEffect(() => () => setSheet(false), []);

  const nowHm = taipeiHm();
  // 背景跟著現在的時間換；ideabox://?sky=day|dusk|night 可以預覽別的時段
  const preview = useLocalSearchParams<{ sky?: string }>().sky;
  const sky: Sky = SKIES[preview && preview in SKIES ? (preview as SkyKey) : skyKeyAt(nowHm)];
  const today = data?.today ?? "";
  const todayEvents = useMemo(
    () => (data?.events ?? []).filter((e) => e.start_date <= today && e.end_date >= today).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99")),
    [data, today],
  );
  const pickedIdx = picked ? todayEvents.findIndex((e) => e.id === picked) : -1;
  const index = pickedIdx >= 0 ? pickedIdx : defaultIndex(todayEvents, nowHm);
  // 動畫：手指拖著月亮和大字跟著走（drag）；換一件事時新的大字從滑的方向進來（slide、fade）
  const drag = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const dir = useRef(0);
  const move = useRef((_: number) => {});
  move.current = (d: number) => {
    const n = Math.min(todayEvents.length - 1, Math.max(0, index + d));
    if (n === index || !todayEvents[n]) return;
    dir.current = d;
    setPicked(todayEvents[n].id);
  };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        if (!reduceMotion()) drag.setValue(g.dx);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx <= -40) move.current(1);
        else if (g.dx >= 40) move.current(-1);
        Animated.spring(drag, { toValue: 0, ...SPRING }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, ...SPRING }).start();
      },
    }),
  ).current;

  const curId = todayEvents[index]?.id ?? "";
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const first = seen.current === null;
    const d = dir.current || (first ? 0 : 1);
    dir.current = 0;
    seen.current = curId;
    if (first || reduceMotion()) return;
    slide.setValue(d * 44);
    fade.setValue(0);
    const anim = Animated.parallel([Animated.spring(slide, { toValue: 0, ...SPRING }), Animated.timing(fade, { toValue: 1, duration: 240, useNativeDriver: true })]);
    anim.start();
    return () => anim.stop();
  }, [curId, slide, fade]);

  // 圓弧上發光的那一點：換一件事時沿著畫面滑到新的位置
  const P0 = { x: 40, y: 118 };
  const P1 = { x: W / 2, y: -40 };
  const P2 = { x: W - 40, y: 118 };
  const at = (t: number) => ({ x: (1 - t) ** 2 * P0.x + 2 * (1 - t) * t * P1.x + t * t * P2.x, y: (1 - t) ** 2 * P0.y + 2 * (1 - t) * t * P1.y + t * t * P2.y });
  const curTime = todayEvents[index]?.start_time ?? null;
  const onPos = curTime ? at(arcT(curTime)) : null;
  const glow = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const glowSet = useRef(false);
  const gx = onPos?.x ?? null;
  const gy = onPos?.y ?? null;
  useEffect(() => {
    if (gx == null || gy == null) {
      glowSet.current = false;
      return;
    }
    if (!glowSet.current || reduceMotion()) {
      glowSet.current = true;
      glow.setValue({ x: gx, y: gy });
      return;
    }
    const anim = Animated.spring(glow, { toValue: { x: gx, y: gy }, ...SPRING });
    anim.start();
    return () => anim.stop();
  }, [gx, gy, glow]);

  // 由 drag、slide 算出來的動畫節點只建一次（每次重畫都重建的話，原生端要一直掛上卸下）
  const nodes = useMemo(
    () => ({
      textX: Animated.add(slide, Animated.multiply(drag, 0.4)),
      moonX: Animated.add(Animated.multiply(slide, 0.35), Animated.multiply(drag, 0.2)),
      moonSpin: Animated.add(Animated.multiply(slide, 2), drag).interpolate({ inputRange: [-300, 300], outputRange: ["-10deg", "10deg"] }),
    }),
    [drag, slide],
  );

  // 清單拉出來：原本的畫面縮小淡掉，清單從下面浮上來
  const sp = usePresence(sheet);

  if (loading && !data) return <Loading />;
  if (!data) return <View style={{ flex: 1, backgroundColor: "#000000", paddingTop: insets.top + 40 }}>{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</View>;

  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  const upcoming = data.events.filter((e) => e.start_date > today).sort((a, b) => (a.start_date + (a.start_time ?? "99")).localeCompare(b.start_date + (b.start_time ?? "99")));
  const down = data.monitor.filter((m) => !m.ok);
  const active = data.projects.filter((p) => p.status === "active");
  const soonMs = data.milestones.filter((m) => m.due >= today && m.due <= addDays(today, 7)).sort((a, b) => a.due.localeCompare(b.due))[0];
  const cur = todayEvents[index] as AppEvent | undefined;
  const timed = todayEvents.filter((e) => e.start_time);
  const done = todayEvents.filter((e) => isPast(e, nowHm)).length;

  // 大字要講什麼：今天選到的那件 → 沒有就講之後最近的一件 → 都沒有
  const head = cur
    ? { title: cur.title, sub: [cur.start_time ?? "整天", name.get(cur.project_id)].filter(Boolean).join("・") }
    : upcoming[0]
      ? { title: upcoming[0].title, sub: [relDay(today, upcoming[0].start_date), upcoming[0].start_time, name.get(upcoming[0].project_id)].filter(Boolean).join("・") }
      : { title: "沒有排程，專心做事", sub: "接下來 14 天都沒有安排" };

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: "排程", value: todayEvents.length ? `今天 ${todayEvents.length} 個` : "今天沒有" },
    { label: "里程碑", value: soonMs ? relDay(today, soonMs.due) : "7 天內沒有" },
    { label: "服務", value: !data.monitor.length ? "還沒監控" : down.length ? `${down.length} 項異常` : `${data.monitor.length} 項正常`, warn: down.length > 0 },
  ];

  const k = Math.min(1, W / 390, (H - insets.top - insets.bottom) / 760);
  const ball = Math.round(258 * k);
  // 圓弧：二次曲線，點的位置照時間算
  const arcW = W;
  const { textX, moonX, moonSpin } = nodes;
  const mainOut = sp.v.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: "clamp" });
  const dots = timed.map((e) => ({ e, ...at(arcT(e.start_time!)), on: e.id === cur?.id, past: isPast(e, nowHm) }));
  const nowDot = at(arcT(nowHm));
  const showTimes = timed.length <= 4;

  return (
    <View style={{ flex: 1, backgroundColor: sky.base, experimental_backgroundImage: sky.bg }}>
      {sky.stars ? STARS.map(([sx, sy, so], i) => <View key={i} pointerEvents="none" style={{ position: "absolute", left: sx * W, top: sy * H, width: 2, height: 2, borderRadius: 1, backgroundColor: "#ffffff", opacity: so }} />) : null}
      {/* 標題 */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 26, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View>
          <Text accessibilityRole="header" style={{ fontSize: 27, fontWeight: "700", color: "#ffffff", lineHeight: 31 }}>今天</Text>
          <Text style={{ fontSize: 27, fontWeight: "700", color: DIM, lineHeight: 31 }}>{today ? `${+today.slice(8, 10)} 週${weekday(today)}` : ""}</Text>
        </View>
        {sp.mounted ? (
          <Animated.View style={{ width: 84, height: 84, borderRadius: 42, boxShadow: "0px 0px 34px rgba(255,255,255,0.18)", opacity: sp.v, transform: [{ scale: sp.v.interpolate({ inputRange: [0, 1], outputRange: [1.6, 1] }) }] }}><Image source={MOON} style={{ width: 84, height: 84 }} /></Animated.View>
        ) : todayEvents.length > 1 ? (
          <View style={{ marginTop: 8, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", justifyContent: "center" }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#ffffff" }}>第 {index + 1} 件・共 {todayEvents.length} 件</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
      {sp.mounted ? (
        <Animated.View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 2, opacity: sp.v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }), transform: [{ translateY: sp.v.interpolate({ inputRange: [0, 1], outputRange: [70, 0] }) }] }}>
        <Sheet
          sky={sky}
          bottom={Math.max(insets.bottom, 12) + 76}
          refreshing={refreshing}
          onRefresh={refresh}
          error={error}
          down={down.map((m) => `${m.label} 連不上`)}
          today={todayEvents.map((e) => ({ id: e.id, time: e.start_time ?? "整天", title: e.title + (e.end_date > e.start_date ? `（到 ${md(e.end_date)}）` : ""), sub: name.get(e.project_id) ?? "", past: isPast(e, nowHm), next: e.id === todayEvents[defaultIndex(todayEvents, nowHm)]?.id && !isPast(e, nowHm), until: e.start_time && !isPast(e, nowHm) ? until(nowHm, e.start_time) : null }))}
          doneCount={done}
          onPick={(id) => {
            setPicked(id);
            setSheet(false);
          }}
          later={[
            ...upcoming.map((e) => ({ key: `e${e.id}`, day: e.start_date, title: `${e.start_time ? `${e.start_time} ` : ""}${e.title}`, sub: name.get(e.project_id) ?? "" })),
            ...data.milestones.filter((m) => m.due > today).map((m) => ({ key: `m${m.id}`, day: m.due, title: `◆ ${m.title}`, sub: `${name.get(m.project_id) ?? ""} 里程碑` })),
          ]
            .sort((a, b) => a.day.localeCompare(b.day))
            .slice(0, 10)
            .map((x) => ({ ...x, left: daysBetween(today, x.day) <= 2 ? relDay(today, x.day) : `${+x.day.slice(5, 7)}/${+x.day.slice(8, 10)}` }))}
          projects={active.map((p) => ({ id: p.id, slug: p.slug, name: p.name, sub: [p.stage ? `${p.stage}（${p.stage_index + 1}/${p.stage_count}）` : null, p.next_step ? `下一步：${p.next_step}` : null].filter(Boolean).join("\n") }))}
        />
        </Animated.View>
      ) : null}
        <Animated.View
          pointerEvents={sheet ? "none" : "auto"}
          accessibilityElementsHidden={sheet}
          importantForAccessibility={sheet ? "no-hide-descendants" : "auto"}
          style={{ flex: 1, paddingBottom: Math.max(insets.bottom, 12) + 70, opacity: mainOut, transform: [{ scale: sp.v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) }] }}
        >
          {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
          {/* 大球：左右滑換一件事 */}
          <View {...pan.panHandlers} style={{ flex: 1, minHeight: ball + 8, alignItems: "center", justifyContent: "center", flexDirection: "row" }}>
            <Arrow dir="left" show={index > 0} onPress={() => move.current(-1)} label="上一件事" />
            <Animated.View style={{ width: ball, height: ball, borderRadius: ball / 2, boxShadow: "0px 0px 80px rgba(255,236,214,0.22)", transform: [{ translateX: moonX }, { rotate: moonSpin }] }}><Image source={MOON} accessibilityIgnoresInvertColors style={{ width: ball, height: ball }} /></Animated.View>
            <Arrow dir="right" show={index < todayEvents.length - 1} onPress={() => move.current(1)} label="下一件事" />
          </View>

          <Pressable onPress={() => canSee("calendar") && router.navigate("/calendar")} accessibilityRole="button" accessibilityLabel={`${head.title}，${head.sub}。點一下看月曆`} style={{ paddingHorizontal: 20 }}>
            <Animated.View style={{ alignItems: "center", opacity: fade, transform: [{ translateX: textX }] }}>
            <Text style={{ fontSize: 28, fontWeight: "700", color: "#ffffff", textAlign: "center" }} numberOfLines={2}>{head.title}</Text>
            <Text style={{ fontSize: 20, fontWeight: "600", color: DIM, marginTop: 4, textAlign: "center" }} numberOfLines={1}>{head.sub}</Text>
            </Animated.View>
          </Pressable>

          <View style={{ flexDirection: "row", paddingHorizontal: 26, marginTop: 22 }}>
            {stats.map((s) => (
              <View key={s.label} style={{ flex: 1, alignItems: "center" }}>
                <Text style={{ fontSize: 18, fontWeight: "600", color: "#ffffff" }}>{s.label}</Text>
                <Text style={{ fontSize: 14, fontWeight: s.warn ? "800" : "400", color: s.warn ? "#ffe14a" : SOFT, marginTop: 1 }}>{s.value}</Text>
              </View>
            ))}
          </View>

          {/* 今天的時間軸：一件事一個點（做完的淡、現在這件發光、還沒到的空心），小白點是現在 */}
          <View style={{ height: 132, marginTop: 6 }}>
            <Svg width={arcW} height={132}>
              <Path d={`M${P0.x} ${P0.y} Q ${P1.x} ${P1.y} ${P2.x} ${P2.y}`} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={2} strokeDasharray="1 9" strokeLinecap="round" />
              {!dots.length ? <Circle cx={nowDot.x} cy={nowDot.y} r={17} fill="rgba(255,255,255,0.22)" /> : null}
              {!dots.length ? <Circle cx={nowDot.x} cy={nowDot.y} r={7} fill="#ffffff" /> : <Circle cx={nowDot.x} cy={nowDot.y} r={2.5} fill="#ffffff" />}
              {dots.map((d) =>
                d.on ? null : d.past ? (
                  <Circle key={d.e.id} cx={d.x} cy={d.y} r={5} fill="rgba(255,255,255,0.45)" />
                ) : (
                  <Circle key={d.e.id} cx={d.x} cy={d.y} r={5} fill={sky.dot} stroke="#ffffff" strokeWidth={2} />
                ),
              )}
            </Svg>
            {onPos ? (
              <Animated.View pointerEvents="none" style={{ position: "absolute", left: -17, top: -17, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center", transform: [{ translateX: glow.x }, { translateY: glow.y }] }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: "#ffffff" }} />
              </Animated.View>
            ) : null}
            {dots.map((d) =>
              showTimes || d.on ? (
                <Text key={d.e.id} style={{ position: "absolute", left: d.x - 24, top: d.y + (d.on ? 22 : 10), width: 48, textAlign: "center", fontSize: 13, fontWeight: d.on ? "700" : "400", color: d.on ? "#ffffff" : SOFT }}>{d.e.start_time}</Text>
              ) : null,
            )}
            {dots.map((d) => (
              <Pressable key={`${d.e.id}p`} onPress={() => setPicked(d.e.id)} accessibilityRole="button" accessibilityLabel={`${d.e.start_time} ${d.e.title}`} style={{ position: "absolute", left: d.x - 22, top: d.y - 22, width: 44, height: 44 }} />
            ))}
            {!dots.length ? <Text style={{ position: "absolute", left: 0, right: 0, top: 96, textAlign: "center", fontSize: 13, color: SOFT }}>現在 {nowHm}</Text> : null}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

function Arrow({ dir, show, onPress, label }: { dir: "left" | "right"; show: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} disabled={!show} accessibilityRole="button" accessibilityLabel={label} accessibilityElementsHidden={!show} style={{ width: 52, height: 52, alignItems: "center", justifyContent: "center", opacity: show ? 0.85 : 0 }}>
      <SymbolView name={dir === "left" ? "chevron.left" : "chevron.right"} size={20} tintColor="#ffffff" weight="semibold" />
    </Pressable>
  );
}

type SheetProps = {
  sky: Sky;
  bottom: number;
  refreshing: boolean;
  onRefresh: () => void;
  error: string | null;
  down: string[];
  today: { id: string; time: string; title: string; sub: string; past: boolean; next: boolean; until: string | null }[];
  doneCount: number;
  onPick: (id: string) => void;
  later: { key: string; left: string; title: string; sub: string }[];
  projects: { id: string; slug: string; name: string; sub: string }[];
};

/** 往上拉的清單：今天全部、接下來、進行中的專案 */
function Sheet({ sky, bottom, refreshing, onRefresh, error, down, today, doneCount, onPick, later, projects }: SheetProps) {
  const line = { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.12)" } as const;
  return (
    <View style={{ flex: 1, marginTop: 14, marginHorizontal: 12, marginBottom: bottom, borderRadius: 32, backgroundColor: sky.panel, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
      <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.45)", marginTop: 10 }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#ffffff" />}>
        {error ? <Text style={{ color: "#ffe14a", fontSize: 14, marginTop: 12 }}>{error}</Text> : null}
        {down.map((d) => (
          <View key={d} accessibilityRole="alert" style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16, backgroundColor: "rgba(120,10,20,0.6)", borderWidth: 1, borderColor: "rgba(255,120,130,0.6)" }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: "#ffffff" }}>{d}</Text>
          </View>
        ))}

        <View style={{ marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700", color: "#ffffff" }}>{today.length ? `今天 ${today.length} 件事` : "今天沒有排程"}</Text>
          {today.length ? <Text style={{ fontSize: 14, color: SOFT }}>完成 {doneCount}・還有 {today.length - doneCount}</Text> : null}
        </View>
        <View style={{ marginTop: 6 }}>
          {today.map((e, i) => (
            <Pressable
              key={e.id}
              onPress={() => onPick(e.id)}
              accessibilityRole="button"
              style={[
                { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
                e.next ? { paddingHorizontal: 12, marginHorizontal: -12, marginVertical: 4, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" } : i < today.length - 1 ? line : null,
              ]}
            >
              <Text style={{ width: 54, fontSize: 17, fontWeight: e.next ? "700" : "600", color: e.past ? DIM : "#ffffff", fontVariant: ["tabular-nums"] }}>{e.time}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: e.next ? "700" : "600", color: e.past ? DIM : "#ffffff", textDecorationLine: e.past ? "line-through" : "none" }} numberOfLines={2}>{e.title}</Text>
                <Text style={{ fontSize: 13, color: e.past ? DIM : SOFT, marginTop: 1 }} numberOfLines={1}>{[e.sub, e.next ? e.until : null].filter(Boolean).join("・")}</Text>
              </View>
              {e.past ? <SymbolView name="checkmark" size={16} tintColor="rgba(255,255,255,0.7)" weight="bold" /> : null}
              {e.next ? (
                <View style={{ height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#ffffff", justifyContent: "center" }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: sky.ink }}>下一件</Text>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>

        {later.length ? <Text accessibilityRole="header" style={{ marginTop: 16, fontSize: 14, fontWeight: "700", color: SOFT }}>接下來</Text> : null}
        {later.map((x, i) => (
          <View key={x.key} style={[{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }, i < later.length - 1 ? line : null]}>
            <Text style={{ width: 54, fontSize: 15, fontWeight: "600", color: "#ffffff" }}>{x.left}</Text>
            <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: "#ffffff" }} numberOfLines={2}>{x.title}</Text>
            <Text style={{ fontSize: 13, color: SOFT, maxWidth: 110 }} numberOfLines={1}>{x.sub}</Text>
          </View>
        ))}

        {projects.length ? <Text accessibilityRole="header" style={{ marginTop: 16, fontSize: 14, fontWeight: "700", color: SOFT }}>進行中的專案</Text> : null}
        {projects.map((p, i) => (
          <Pressable
            key={p.id}
            onPress={canSee("projects") ? () => router.navigate({ pathname: "/projects/[slug]", params: { slug: p.slug } }) : undefined}
            accessibilityRole="button"
            style={[{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }, i < projects.length - 1 ? line : null]}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: projectColor(p.id) }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#ffffff" }}>{p.name}</Text>
              {p.sub ? <Text style={{ fontSize: 13, color: SOFT, marginTop: 1, lineHeight: 18 }} numberOfLines={3}>{p.sub}</Text> : null}
            </View>
            <SymbolView name="chevron.right" size={13} tintColor="rgba(255,255,255,0.6)" weight="semibold" />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
