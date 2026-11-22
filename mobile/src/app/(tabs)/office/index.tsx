// 辦公室（2.4「會走動的房間」）：一間真的房間，用家具分區，不畫框也不寫區域名稱——
// 桌子＝工作中（輕輕彈、筆電亮著）、沙發＝休息（打呼）、門口的橘光＝有事找你（在光裡跳）；
// 交接時小球帶著文件滾去同事那邊。窗外與時鐘跟著台北時間，都下班就關燈。
// 點一顆小球：其他人變淡，下面講他在做什麼；點空白的地方收起來，左右滑換下一個人。
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, useWindowDimensions, View, type ViewStyle } from "react-native";
import Svg, { Line as SvgLine } from "react-native-svg";
import { Icon } from "@/components/Icon";
import { Orb, type Mood } from "@/components/Orb";
import { Big, Card, Dot, Empty, ErrorNote, Head, Line, Loading, Page, projectColor, Tag, Txt } from "@/components/ui";
import { ago, taipeiHm } from "@/lib/format";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useSwipe } from "@/lib/swipe";
import { useTheme } from "@/lib/theme";
import type { OfficeData, OfficePerson, OfficeStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const RANK: Record<OfficeStatus, number> = { permission: 0, waiting: 1, working: 2, idle: 3, ended: 4 };
const needsYou = (s: OfficeStatus) => s === "waiting" || s === "permission";
const statusText = (s: OfficeStatus) => ({ working: L("工作中", "Working"), waiting: L("等你回覆", "Waiting for you"), permission: L("等你同意", "Needs your OK"), idle: L("休息中", "Resting"), ended: L("下班", "Off") })[s];

// 房間是照 350×410 畫的，實際寬度不同就等比例縮放
const RW = 350;
const RH = 410;
/** 四張桌子的左上角 */
const DESKS: [number, number][] = [[18, 232], [122, 232], [18, 344], [122, 344]];
/** 門口排隊的位置（最多兩個）與沙發上的位置：[左, 上, 直徑] */
const DOOR: [number, number, number][] = [[262, 196, 58], [226, 253, 46]]; // 第二個排在斜後方（順著地上的光），兩顆不重疊
const SOFA: [number, number, number] = [268, 292, 46];
// 房間裡的顏色（家具），只有這一頁用
const C = { wall: "#1b1e29", wallDark: "#101219", floor: "#12141b", floorDark: "#0a0b10", trim: "#252936", wood: "#2c3040", leg: "#1f222d", frame: "#2b2f3d", lid: "#3a3f50", leaf: "#2f7a5f", bubble: "#2c3040" };

type Spot = { p: OfficePerson; x: number; y: number; size: number; at: "desk" | "door" | "sofa"; desk?: number };

/** 把上班中的人排進房間：要找你的站門口（兩個），工作中的坐桌子，休息的一個在沙發、其他趴在空桌子上；排不下的不畫 */
function seat(on: OfficePerson[]): { spots: Spot[]; left: number } {
  const spots: Spot[] = [];
  const free = [0, 1, 2, 3];
  let door = 0;
  let sofa = false;
  const atDesk = (p: OfficePerson) => {
    const d = free.shift();
    if (d === undefined) return false;
    spots.push({ p, x: DESKS[d][0] + 17, y: DESKS[d][1] - 42, size: 54, at: "desk", desk: d });
    return true;
  };
  let left = 0;
  for (const p of on) {
    if (needsYou(p.status) && door < DOOR.length) {
      const [x, y, size] = DOOR[door++];
      spots.push({ p, x, y, size, at: "door" });
    } else if (p.status === "idle" && !sofa) {
      sofa = true;
      spots.push({ p, x: SOFA[0], y: SOFA[1], size: SOFA[2], at: "sofa" });
    } else if (!atDesk(p)) left++;
  }
  return { spots, left };
}

/** 小球的動作：work＝輕輕彈、hop＝在門口跳、nap＝睡著慢慢起伏 */
function Mover({ kind, delay = 0, children }: { kind: "work" | "hop" | "nap" | "still"; delay?: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (kind === "still" || reduceMotion()) return;
    const up = (duration: number, easing = Easing.inOut(Easing.sin)) => Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true });
    const down = (duration: number, easing = Easing.inOut(Easing.sin)) => Animated.timing(v, { toValue: 0, duration, easing, useNativeDriver: true });
    const a = Animated.loop(
      kind === "hop"
        ? Animated.sequence([Animated.delay(delay), up(240, Easing.out(Easing.quad)), down(260, Easing.in(Easing.quad)), Animated.delay(900 - delay)])
        : kind === "nap"
          ? Animated.sequence([up(1700), down(1700)])
          : Animated.sequence([Animated.delay(delay), up(480), down(480)]),
    );
    a.start();
    return () => a.stop();
  }, [v, kind, delay]);
  const transform =
    kind === "hop"
      ? [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }, { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }]
      : kind === "nap"
        ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }]
        : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }];
  return <Animated.View style={{ transform }}>{children}</Animated.View>;
}

/** 交接：帶著文件滾去同事那邊，停一下再滾回來 */
function Roller({ dx, dy, children }: { dx: number; dy: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    if (reduceMotion()) return;
    const go = (toValue: number) => Animated.timing(v, { toValue, duration: 1900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true });
    const a = Animated.loop(Animated.sequence([Animated.delay(700), go(1), Animated.delay(700), go(0)]));
    a.start();
    return () => a.stop();
  }, [v, dx, dy]);
  return (
    <Animated.View style={{ transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "10deg"] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** 一閃一閃：打字中的三個點、往上飄的 z、咖啡的熱氣 */
function Pulse({ ms = 1200, delay = 0, rise = 0, style, children }: { ms?: number; delay?: number; rise?: number; style?: ViewStyle; children?: ReactNode }) {
  const v = useRef(new Animated.Value(reduceMotion() ? 0.5 : 0)).current;
  useEffect(() => {
    if (reduceMotion()) return;
    const a = Animated.loop(Animated.sequence([Animated.delay(delay), Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: 1, useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [v, ms, delay]);
  return <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.25, 1, rise ? 0 : 0.25] }), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) }] }]}>{children}</Animated.View>;
}

export default function Office() {
  const t = useTheme();
  const { width: W } = useWindowDimensions();
  const { data, error, loading, refreshing, refresh } = useApi<OfficeData>("/api/app/office", { pollMs: 5_000 });
  const [showOff, setShowOff] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // 點到誰（key）；沒點＝下面講最要緊的那個
  const sorted = [...(data?.people ?? [])].sort((a, b) => RANK[a.status] - RANK[b.status] || b.updated_at.localeCompare(a.updated_at));
  const { spots, left } = seat(sorted.filter((p) => p.status !== "ended"));
  const shown = spots.map((s) => s.p);
  const sel = spots.find((s) => s.p.key === picked) ?? null;
  const index = Math.max(0, shown.findIndex((p) => p.key === (sel?.p.key ?? shown[0]?.key)));
  const swipe = useSwipe(shown.length, index, (i) => setPicked(shown[i]?.key ?? null));
  if (loading && !data) return <Loading />;
  if (!data) return <Page onRefresh={refresh}><Head title={L("辦公室", "Office")} />{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</Page>;

  const k = (W - 40) / RW;
  const box = (l: number, top: number, w: number, h: number, more?: ViewStyle): ViewStyle => ({ position: "absolute", left: l * k, top: top * k, width: w * k, height: h * k, ...more });
  const room = (id: string) => data.rooms.find((r) => r.id === id)?.name ?? L("大廳", "Lobby");
  const colorOf = (p: OfficePerson) => (p.room === "lobby" ? t.muted : projectColor(p.room));
  const role = (p: OfficePerson) => p.role ?? L("待分配", "Unassigned");
  const off = sorted.filter((p) => p.status === "ended");
  const working = shown.filter((p) => p.status === "working").length;
  const waiting = sorted.filter((p) => needsYou(p.status));
  const atDoor = spots.filter((s) => s.at === "door");
  const now = data.now;
  const empty = !shown.length;
  const cur = sel?.p ?? shown[0];

  // 窗外與時鐘跟著台北時間；沒人上班就關燈
  const hm = taipeiHm(new Date(now));
  const hour = +hm.slice(0, 2);
  const minute = +hm.slice(3, 5);
  const sky = empty || hour < 5 || hour >= 19 ? "night" : hour >= 16 ? "dusk" : "day";
  const SKY = { day: "linear-gradient(#3b8fe0, #9fd0f5)", dusk: "linear-gradient(#3a2f6b, #f08a5d)", night: "linear-gradient(#0a1030, #1f2f66)" }[sky];

  // 交接：兩個人都在房間裡、交的人坐在桌子上才畫
  const pass = (data.handoffs ?? [])
    .map((h) => ({ from: spots.find((s) => s.p.key === h.from && s.at === "desk"), to: spots.find((s) => s.p.key === h.to) }))
    .find((h) => h.from && h.to) as { from: Spot; to: Spot } | undefined;
  const passDx = pass ? (pass.to.x + pass.to.size / 2 - (pass.from.x + pass.from.size / 2)) * 0.72 : 0;
  const passDy = pass ? (pass.to.y + pass.to.size / 2 - (pass.from.y + pass.from.size / 2)) * 0.72 : 0;

  const pick = (key: string | null) => {
    Haptics.selectionAsync().catch(() => null);
    setPicked(key);
  };
  const hand = (deg: number, len: number) => (
    <View style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, transform: [{ rotate: `${deg}deg` }] }}>
      <View style={{ position: "absolute", left: -1 * k, bottom: 0, width: 2 * k, height: len * k, borderRadius: 2, backgroundColor: t.muted }} />
    </View>
  );
  /** 泡泡：左下角是尖的；靠右邊的往左長，才不會超出房間 */
  const bubble = (cx: number, top: number, bg: string, child: ReactNode, key: string) => {
    const right = cx > RW * 0.6;
    return (
      <View key={key} pointerEvents="none" style={{ position: "absolute", top: top * k, ...(right ? { right: Math.max(8, RW - cx - 40) * k } : { left: Math.max(8, cx - 30) * k }), maxWidth: 210 * k, zIndex: 9, backgroundColor: bg, borderRadius: 12, borderBottomLeftRadius: right ? 12 : 4, borderBottomRightRadius: right ? 4 : 12, paddingVertical: 5, paddingHorizontal: 9, boxShadow: "0px 6px 14px rgba(0,0,0,0.35)" }}>
        {child}
      </View>
    );
  };

  const deskOf = (i: number) => spots.find((s) => s.desk === i);

  return (
    <Page refreshing={refreshing} onRefresh={refresh} swiping={swipe.dragging}>
      <Head
        title={L("辦公室", "Office")}
        sub={empty ? L("沒有人在工作", "Nobody is working") : L(`${working} 個在工作`, `${working} working`)}
        right={waiting.length ? <Tag big tone="acc">{L(`${waiting.length} 人等你`, `${waiting.length} waiting`)}</Tag> : undefined}
      />
      {error ? <ErrorNote text={error} onRetry={refresh} /> : null}
      {!data.ready ? <ErrorNote text={L("辦公室還沒準備好：ideabox 的資料庫要先執行 migration-014。", "Office isn't ready: run migration-014 first.")} /> : null}

      <Pressable onPress={() => (picked ? pick(null) : undefined)} accessibilityRole="image" accessibilityLabel={empty ? L("辦公室關燈了，沒有人在", "The office is dark, nobody is in") : L(`辦公室：${working} 個在位子上工作，${waiting.length} 個在門口等你`, `Office: ${working} working at desks, ${waiting.length} waiting at the door`)} style={{ height: RH * k, marginTop: 14, borderRadius: 28, overflow: "hidden", backgroundColor: empty ? C.floorDark : C.floor }}>
        {/* 牆、踢腳板、窗戶照進來的光 */}
        <View style={box(0, 0, RW, 168, { backgroundColor: empty ? C.wallDark : C.wall })} />
        <View style={box(0, 163, RW, 5, { backgroundColor: C.trim, opacity: empty ? 0.5 : 1 })} />
        <View style={box(34, 174, 104, 104, { borderRadius: 12, transform: [{ skewX: "-20deg" }], experimental_backgroundImage: `linear-gradient(rgba(160,200,255,${empty ? 0.13 : 0.08}), rgba(160,200,255,0))` } as ViewStyle)} />
        {/* 窗戶：白天有太陽和雲、傍晚夕陽、晚上月亮和星星 */}
        <View style={box(22, 30, 104, 86, { borderRadius: 18 * k, borderWidth: 4 * k, borderColor: C.frame, overflow: "hidden", experimental_backgroundImage: SKY } as ViewStyle)}>
          <View style={{ position: "absolute", right: 14 * k, top: (sky === "dusk" ? 46 : 10) * k, width: 18 * k, height: 18 * k, borderRadius: 9 * k, backgroundColor: sky === "day" ? "#fff6c9" : sky === "dusk" ? "#ffd3a1" : "#f1eedb", boxShadow: `0px 0px ${14 * k}px rgba(255,240,200,0.6)` }} />
          {sky === "day" ? <View style={{ position: "absolute", left: 8 * k, top: 38 * k, width: 38 * k, height: 12 * k, borderRadius: 6 * k, backgroundColor: "rgba(255,255,255,0.75)" }} /> : null}
          {sky === "night" ? [[12, 14], [32, 42], [66, 54], [22, 60]].map(([x, y]) => <View key={`${x}`} style={{ position: "absolute", left: x * k, top: y * k, width: 2, height: 2, borderRadius: 1, backgroundColor: "#fff", opacity: 0.8 }} />) : null}
          <View style={{ position: "absolute", left: "50%", marginLeft: -1.5 * k, top: 0, bottom: 0, width: 3 * k, backgroundColor: C.frame }} />
        </View>
        {/* 時鐘（台北時間）、白板、盆栽 */}
        <View style={box(148, 36, 34, 34, { borderRadius: 17 * k, borderWidth: 3 * k, borderColor: C.frame, backgroundColor: "#12141b" })}>
          {hand((hour % 12) * 30 + minute / 2, 8)}
          {hand(minute * 6, 11)}
        </View>
        <View style={box(198, 32, 62, 48, { borderRadius: 10 * k, backgroundColor: C.trim, flexDirection: "row", flexWrap: "wrap", gap: 5 * k, padding: 8 * k, opacity: empty ? 0.45 : 1 })}>
          {[t.main, t.acc, C.lid, t.ok, C.lid, t.main].map((c, i) => <View key={i} style={{ width: 12 * k, height: 12 * k, borderRadius: 3 * k, backgroundColor: c }} />)}
        </View>
        <View style={box(150, 126, 30, 44, { opacity: empty ? 0.45 : 1 })}>
          {[[-24, 3, 24], [0, 9, 30], [24, 15, 24]].map(([deg, x, h]) => <View key={x} style={{ position: "absolute", left: x * k, bottom: 14 * k, width: 12 * k, height: h * k, borderRadius: 12 * k, borderBottomRightRadius: 2, backgroundColor: C.leaf, transform: [{ rotate: `${deg}deg` }] }} />)}
          <View style={{ position: "absolute", left: 6 * k, bottom: 0, width: 18 * k, height: 16 * k, borderRadius: 3 * k, borderBottomLeftRadius: 7 * k, borderBottomRightRadius: 7 * k, backgroundColor: C.frame }} />
        </View>
        {/* 門：有人找你才打開，橘光照在地上 */}
        {atDoor.length ? (
          <>
            <View style={box(176, 168, 174, 150, { experimental_backgroundImage: "radial-gradient(ellipse at 78% 0%, rgba(255,138,61,0.42) 0%, rgba(255,138,61,0) 70%)" } as ViewStyle)} />
            <View style={box(284, 44, 50, 124, { borderTopLeftRadius: 16 * k, borderTopRightRadius: 16 * k, overflow: "hidden", experimental_backgroundImage: "linear-gradient(#ffc590, #ff8a3d)", boxShadow: "0px 0px 44px rgba(255,138,61,0.5)" } as ViewStyle)}>
              <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 13 * k, backgroundColor: C.frame }} />
            </View>
          </>
        ) : (
          <View style={box(284, 44, 50, 124, { borderTopLeftRadius: 16 * k, borderTopRightRadius: 16 * k, backgroundColor: C.trim, opacity: empty ? 0.6 : 1 })}>
            <View style={{ position: "absolute", right: 8 * k, top: 64 * k, width: 6 * k, height: 6 * k, borderRadius: 3 * k, backgroundColor: "#4a5064" }} />
          </View>
        )}
        {/* 休息區：地毯、沙發椅背（人坐在椅背前面、坐墊後面） */}
        <View style={box(226, 334, 124, 64, { borderRadius: 62 * k, backgroundColor: "rgba(255,255,255,0.045)" })} />
        <View style={box(253, 305, 76, 28, { borderTopLeftRadius: 14 * k, borderTopRightRadius: 14 * k, backgroundColor: "#232735", opacity: empty ? 0.6 : 1 })} />

        {/* 交接的路線 */}
        {pass ? (
          <Svg style={{ position: "absolute", left: 0, top: 0 }} width={RW * k} height={RH * k} pointerEvents="none">
            <SvgLine x1={(pass.from.x + pass.from.size / 2) * k} y1={(pass.from.y + pass.from.size) * k} x2={(pass.from.x + pass.from.size / 2 + passDx) * k} y2={(pass.from.y + pass.from.size / 2 + passDy) * k} stroke={t.main} strokeWidth={2.5} strokeDasharray="1 8" strokeLinecap="round" />
          </Svg>
        ) : null}

        {/* 人 */}
        {spots.map((s, i) => {
          const p = s.p;
          const on = sel?.p.key === p.key;
          const rolling = pass?.from.p.key === p.key;
          const kind = sel && !on ? "still" : needsYou(p.status) ? "hop" : p.status === "working" ? "work" : "nap";
          const mood: Mood = needsYou(p.status) ? "curious" : p.status === "working" ? "calm" : "sleep";
          const size = s.size * k;
          const ring = on || s.at === "door";
          const body = (
            <Pressable onPress={() => pick(on ? null : p.key)} hitSlop={8} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${role(p)}，${statusText(p.status)}${p.task ? `，${p.task}` : ""}`}>
              <View style={{ padding: 4, margin: -4 - (ring ? 3 : 0), borderRadius: size, borderWidth: ring ? 3 : 0, borderColor: needsYou(p.status) ? t.acc : t.main }}>
                <Orb size={size} mood={mood} shadow={s.at !== "desk"} still={kind === "still"} />
              </View>
              {rolling ? (
                <View style={{ position: "absolute", right: -6 * k, bottom: -2 * k, width: 16 * k, height: 19 * k, borderRadius: 3, backgroundColor: "#fff", paddingTop: 5 * k, paddingHorizontal: 3 * k, gap: 2 * k }}>
                  <View style={{ height: 2, backgroundColor: t.main }} />
                  <View style={{ height: 2, backgroundColor: "#c5cbdb" }} />
                  <View style={{ height: 2, backgroundColor: "#c5cbdb" }} />
                </View>
              ) : null}
            </Pressable>
          );
          return (
            <View key={p.key} style={{ position: "absolute", left: s.x * k, top: s.y * k, zIndex: s.at === "desk" ? 2 : 4, opacity: sel && !on ? 0.4 : 1 }}>
              {rolling && !sel ? <Roller dx={passDx * k} dy={passDy * k}>{body}</Roller> : <Mover kind={kind} delay={(i % 3) * 180}>{body}</Mover>}
            </View>
          );
        })}

        {/* 桌子（蓋住小球的下半身）、筆電、名牌 */}
        {DESKS.map(([x, y], i) => {
          const s = deskOf(i);
          const lit = s?.p.status === "working" && pass?.from.p.key !== s.p.key;
          return (
            <View key={i} pointerEvents="none" style={box(x, y, 88, 62, { zIndex: 3, opacity: s ? 1 : empty ? 0.4 : 0.55 })}>
              {lit ? <View style={{ position: "absolute", left: -6 * k, top: -44 * k, width: 70 * k, height: 60 * k, experimental_backgroundImage: "radial-gradient(circle at 40% 60%, rgba(47,140,255,0.4) 0%, rgba(47,140,255,0) 60%)" } as ViewStyle} /> : null}
              <View style={{ position: "absolute", left: 8 * k, top: -15 * k, width: 25 * k, height: 17 * k, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: C.lid, alignItems: "center", justifyContent: "center", boxShadow: lit ? "10px -4px 22px rgba(47,140,255,0.6)" : undefined }}>
                {lit ? <View style={{ width: 5 * k, height: 5 * k, borderRadius: 3 * k, backgroundColor: t.main }} /> : null}
              </View>
              <View style={{ position: "absolute", left: 9 * k, right: 9 * k, top: 12 * k, height: 28 * k, borderLeftWidth: 5 * k, borderRightWidth: 5 * k, borderColor: C.leg }} />
              <View style={{ height: 14 * k, borderRadius: 7 * k, backgroundColor: C.wood, borderTopWidth: 1.5, borderTopColor: "rgba(255,255,255,0.08)" }} />
              {s ? (
                <View style={{ position: "absolute", left: -12 * k, right: -12 * k, top: 44 * k, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, opacity: sel && sel.p.key !== s.p.key ? 0.4 : 1 }}>
                  <Dot color={colorOf(s.p)} size={6} />
                  <Txt size={11.5} lh={16} muted numberOfLines={1}>{role(s.p)}</Txt>
                  {lit && !sel ? <View style={{ flexDirection: "row", gap: 2.5, marginLeft: 1 }}>{[0, 1, 2].map((d) => <Pulse key={d} delay={d * 200 + i * 150} style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: t.main }} />)}</View> : null}
                </View>
              ) : null}
            </View>
          );
        })}
        {/* 沙發坐墊、茶几上的咖啡 */}
        <View style={box(248, 322, 86, 38, { zIndex: 5, borderRadius: 15 * k, backgroundColor: C.wood, opacity: empty ? 0.6 : 1 })} pointerEvents="none" />
        <View style={box(232, 366, 20, 20, { zIndex: 5, borderRadius: 10 * k, backgroundColor: C.wood })} pointerEvents="none">
          <View style={{ position: "absolute", left: 6 * k, top: -4 * k, width: 8 * k, height: 8 * k, borderRadius: 2, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: "#e9ebf2" }} />
          {empty ? null : <Pulse ms={2400} rise={8} style={{ position: "absolute", left: 9 * k, top: -12 * k, width: 2, height: 7 * k, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.6)" }} />}
        </View>
        {spots.filter((s) => s.at === "sofa").map((s) => (
          <View key={s.p.key} pointerEvents="none" style={{ position: "absolute", left: 236 * k, top: 364 * k, width: 110 * k, zIndex: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, opacity: sel && sel.p.key !== s.p.key ? 0.4 : 1 }}>
            <Dot color={colorOf(s.p)} size={6} />
            <Txt size={11.5} lh={16} muted numberOfLines={1}>{role(s.p)}</Txt>
          </View>
        ))}

        {/* 泡泡：點到誰就講他在做什麼；沒點的時候，睡著的冒 z、門口的說等你（工作中的三個點在名牌後面） */}
        {sel
          ? bubble(sel.x + sel.size / 2, sel.y - 34, needsYou(sel.p.status) ? t.acc : t.main, <Txt size={12} lh={17} med numberOfLines={1} color={needsYou(sel.p.status) ? t.onAcc : t.onMain}>{sel.p.task ?? statusText(sel.p.status)}</Txt>, "sel")
          : (
            <>
              {pass ? bubble(pass.from.x + pass.from.size / 2, pass.from.y - 32, t.main, <Txt size={11.5} lh={16} med numberOfLines={1} color={t.onMain}>{L(`做好了，交給${role(pass.to.p)}`, `Done, over to ${role(pass.to.p)}`)}</Txt>, "pass") : null}
              {spots.filter((s) => s.p.status === "idle").map((s) => (
                <View key={`z${s.p.key}`} pointerEvents="none" style={{ position: "absolute", left: (s.x + s.size) * k, top: (s.y - 14) * k, zIndex: 9 }}>
                  <Pulse ms={3000} rise={12}><Txt size={12} lh={14} color="#aab0c0">z</Txt></Pulse>
                </View>
              ))}
              {atDoor.length ? bubble(atDoor[0].x + atDoor[0].size / 2, 152, t.acc, <Txt size={11.5} lh={16} med numberOfLines={1} color={t.onAcc}>{atDoor.length > 1 || waiting.length > 1 ? L(`${waiting.length} 人在門口等你`, `${waiting.length} waiting at the door`) : `${role(atDoor[0].p)}：${statusText(atDoor[0].p.status)}`}</Txt>, "door") : null}
            </>
          )}
      </Pressable>

      {empty ? (
        <View style={{ marginTop: 18 }}>
          <Big size={26}>{off.length ? L("都下班了", "Everyone is off") : L("還沒有人", "Nobody yet")}</Big>
          {off.length ? (
            <Txt size={13.5} lh={20} muted style={{ marginTop: 4 }}>{L(`最後一個走的是${role(off[0])}，${ago(off[0].updated_at, now)}`, `${role(off[0])} left last, ${ago(off[0].updated_at, now)}`)}</Txt>
          ) : (
            <Empty text={L("到網頁的專案設定填資料夾名稱，那個資料夾裡的 Claude Code 就會出現在這裡。", "Set a folder name in a project's web settings and its Claude Code sessions show up here.")} />
          )}
        </View>
      ) : cur ? (
        <Animated.View style={swipe.style} {...swipe.handlers} accessibilityHint={L("左右滑換下一個人", "Swipe sideways for the next one")}>
          <Card style={sel ? { paddingVertical: 16, paddingHorizontal: 18 } : undefined} onPress={sel ? undefined : () => pick(cur.key)} label={sel ? undefined : `${role(cur)}，${statusText(cur.status)}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Tag tone={needsYou(cur.status) ? "acc" : cur.status === "working" ? "main" : undefined}>{statusText(cur.status)}</Tag>
              <Txt med size={sel ? 17 : 15} lh={22} numberOfLines={1} style={{ flex: 1 }}>{role(cur)}</Txt>
              <Txt num size={13} lh={18} muted>{ago(cur.updated_at, now)}</Txt>
            </View>
            {sel ? <Txt size={12.5} lh={18} muted style={{ marginTop: 12 }}>{L("正在做", "Working on")}</Txt> : null}
            <Txt size={sel ? 17 : 15} lh={sel ? 25 : 22} numberOfLines={sel ? 4 : 2} style={{ marginTop: sel ? 2 : 6 }}>{cur.task ?? L("沒有在做的事", "Nothing right now")}</Txt>
            {sel ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 }}>
                <Dot color={colorOf(cur)} />
                <Txt size={13.5} lh={19} muted numberOfLines={1} style={{ flex: 1 }}>{[room(cur.room), data.rooms.find((r) => r.id === cur.room)?.stage, cur.sessions > 1 ? L(`${cur.sessions} 個視窗`, `${cur.sessions} sessions`) : null].filter(Boolean).join("・")}</Txt>
              </View>
            ) : null}
          </Card>
          {sel ? <Txt size={12.5} lh={18} muted style={{ textAlign: "center", marginTop: 12 }}>{L("點空白的地方收起來・左右滑換下一個人", "Tap empty space to close・swipe for the next one")}</Txt> : null}
          {!sel && left ? <Txt size={12.5} lh={18} muted style={{ textAlign: "center", marginTop: 10 }}>{L(`房間坐滿了，還有 ${left} 人沒畫出來`, `The room is full: ${left} more not shown`)}</Txt> : null}
        </Animated.View>
      ) : null}

      {off.length && !sel ? (
        <Card style={{ paddingVertical: 4 }} top={empty ? 14 : 10}>
          <Line first onPress={() => setShowOff((v) => !v)}>
            <Txt size={14} muted style={{ flex: 1 }}>{L(`已下班 ${off.length} 人`, `${off.length} off duty`)}</Txt>
            <View style={{ transform: [{ rotate: showOff ? "90deg" : "0deg" }] }}><Icon name="chev" size={16} color={t.muted} /></View>
          </Line>
          {showOff
            ? off.map((p) => (
                <Line key={p.key} style={{ opacity: 0.7 }}>
                  <Dot color={colorOf(p)} />
                  <Txt style={{ flex: 1 }} numberOfLines={1}>{role(p)}</Txt>
                  <Txt num size={13} muted>{`${room(p.room)}　${ago(p.updated_at, now)}`}</Txt>
                </Line>
              ))
            : null}
        </Card>
      ) : null}
    </Page>
  );
}
