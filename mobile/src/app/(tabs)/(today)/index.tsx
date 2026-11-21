// 今天：一頁只講一件事。左邊一行大字是那件事，右下角是小球（表情跟著狀況換）。
// 一天有很多件事：左右滑換上一件／下一件；往上拉出今天的清單（往下拉滑掉）；往下拉重新整理。
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, ScrollView, useWindowDimensions, View, type PanResponderGestureState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/Icon";
import { dockBottom } from "@/components/Menu";
import { Orb, type Mood } from "@/components/Orb";
import { Big, Dot, ErrorNote, Label, Line, Loading, Sig, Small, TimeCell, Txt } from "@/components/ui";
import { setSheet, useSheet } from "@/lib/dock";
import { daysBetween, md, mdShort, pastBy, taipeiHm } from "@/lib/format";
import { L } from "@/lib/i18n";
import { glide, reduceMotion } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { getSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { AppEvent, HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** 合夥人的手機沒有這個畫面就不跳過去（舊的配對沒有 tabs＝全部都有） */
const canSee = (tab: string) => {
  const tabs = getSession()?.tabs;
  return !tabs || tabs.includes(tab);
};

// 往下拉重新整理：手指拉的距離打四折（越拉越緊），拉過 PULL_AT 放手才更新
const PULL_AT = 44;
const pullOf = (dy: number) => Math.min(60, Math.max(0, dy) * 0.4);

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);

/** 「還有 2 小時」「還有 35 分鐘」 */
function until(nowHm: string, at: string): string {
  const m = toMin(at) - toMin(nowHm);
  if (m <= 0) return L("進行中", "now");
  if (m < 60) return L(`還有 ${m} 分鐘`, `in ${m}m`);
  const h = Math.round(m / 60);
  return L(`還有 ${h} 小時`, `in ${h}h`);
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

export default function Today() {
  const t = useTheme();
  usePrefs();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { data, error, loading, refreshing, refresh } = useApi<HomeData>("/api/app/home");
  const sheet = useSheet();
  const [picked, setPicked] = useState<string | null>(null); // 使用者滑到哪一件（事件 id）
  useEffect(() => () => setSheet(false), []);

  const nowHm = taipeiHm();
  const today = data?.today ?? "";
  const todayEvents = useMemo(
    () => (data?.events ?? []).filter((e) => e.start_date <= today && e.end_date >= today).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99")),
    [data, today],
  );
  const pickedIdx = picked ? todayEvents.findIndex((e) => e.id === picked) : -1;
  const index = pickedIdx >= 0 ? pickedIdx : defaultIndex(todayEvents, nowHm);
  const n = todayEvents.length;
  const step = Math.round(W * 0.8);
  // 大字是一排，一件事一段：pos 是整排的位置（第 i 段在 -i*step），手指拖著走，放手吸到最近的一段
  const pos = useRef(new Animated.Value(0)).current;
  // 清單：sy 是它離定位還有多遠（0＝完全拉出來、H＝收在畫面下面），手指可以拖著開、拖著關
  const sy = useRef(new Animated.Value(H)).current;
  // 往下拉重新整理：pull 是小球被拉下來多少
  const pull = useRef(new Animated.Value(0)).current;
  const [armed, setArmed] = useState(false);
  // 手勢的處理函式只建一次，要用到的最新數字放這裡
  const live = useRef({ index, n, step, H, events: todayEvents, refresh });
  live.current = { index, n, step, H, events: todayEvents, refresh };

  /** 換到前後一件；d＝0 或已經到頭就彈回原位 */
  const go = useRef((_: number) => {});
  go.current = (d: number) => {
    const c = live.current;
    const to = Math.min(c.n - 1, Math.max(0, c.index + d));
    if (to === c.index || !c.events[to]) {
      glide(pos, -c.index * c.step);
      return;
    }
    Haptics.selectionAsync().catch(() => null);
    setPicked(c.events[to].id);
  };
  // 選到的那件換了（滑的、從清單挑的）：整排滑到那一段
  const placed = useRef(false);
  useEffect(() => {
    if (!n) return;
    if (!placed.current) {
      placed.current = true;
      pos.setValue(-index * step);
      return;
    }
    glide(pos, -index * step);
  }, [index, step, n, pos]);
  // 清單開關（手勢放手後、點清單裡的事）：彈到定位
  useEffect(() => {
    glide(sy, sheet ? 0 : H);
  }, [sheet, H, sy]);
  // 重新整理讀完了：小球彈回去
  useEffect(() => {
    if (!refreshing) glide(pull, 0);
  }, [refreshing, pull]);
  useEffect(() => {
    if (armed) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => null);
  }, [armed]);

  // 這一頁的手勢：左右＝換一件事、往上＝拉出清單、往下＝重新整理（一開始往哪邊動就算哪一種）
  const axis = useRef<"x" | "up" | "down" | null>(null);
  const end = useRef((_g: PanResponderGestureState, _ok: boolean) => {});
  end.current = (g, ok) => {
    const c = live.current;
    const a = axis.current;
    axis.current = null;
    if (a === "x") {
      const far = c.step * 0.22;
      go.current(!ok ? 0 : g.dx < -far || g.vx < -0.45 ? 1 : g.dx > far || g.vx > 0.45 ? -1 : 0);
    } else if (a === "up") {
      if (ok && (g.dy < -90 || g.vy < -0.5)) {
        setSheet(true);
        glide(sy, 0);
      } else glide(sy, c.H);
    } else if (a === "down") {
      setArmed(false);
      if (ok && pullOf(g.dy) >= PULL_AT) {
        c.refresh();
        glide(pull, 30);
      } else glide(pull, 0);
    }
  };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => {
        const ax = Math.abs(g.dx);
        const ay = Math.abs(g.dy);
        if (ax > 12 && ax > ay * 1.5) axis.current = "x";
        else if (ay > 12 && ay > ax * 1.5) axis.current = g.dy < 0 ? "up" : "down";
        else return false;
        return true;
      },
      onPanResponderMove: (_, g) => {
        const c = live.current;
        if (axis.current === "x") {
          if (c.n < 2 || reduceMotion()) return;
          // 第一件再往右、最後一件再往左：拉得動但很緊
          const edge = (c.index === 0 && g.dx > 0) || (c.index === c.n - 1 && g.dx < 0);
          pos.setValue(-c.index * c.step + (edge ? g.dx * 0.25 : g.dx));
        } else if (axis.current === "up") {
          if (!reduceMotion()) sy.setValue(Math.max(0, c.H + g.dy));
        } else if (axis.current === "down") {
          const d = pullOf(g.dy);
          if (!reduceMotion()) pull.setValue(d);
          setArmed(d >= PULL_AT);
        }
      },
      onPanResponderRelease: (_, g) => end.current(g, true),
      onPanResponderTerminate: (_, g) => end.current(g, false),
    }),
  ).current;

  // 清單的手勢：捲到最上面再往下拉（或拉上面那條把手）＝把清單滑掉
  const scrollY = useRef(0);
  const sheetPan = useRef(
    (() => {
      const make = (handle: boolean) =>
        PanResponder.create({
          onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx) * 1.5 && (handle || scrollY.current <= 0),
          onPanResponderMove: (_, g) => {
            if (!reduceMotion()) sy.setValue(Math.max(0, g.dy));
          },
          onPanResponderRelease: (_, g) => {
            if (g.dy > 110 || g.vy > 0.6) {
              setSheet(false);
              glide(sy, live.current.H);
            } else glide(sy, 0);
          },
          onPanResponderTerminate: () => glide(sy, 0),
          onPanResponderTerminationRequest: () => false,
        });
      return { body: make(false), handle: make(true) };
    })(),
  ).current;

  // 動畫節點只在數量或尺寸變了才重建（每次重畫都重建的話，原生端要一直掛上卸下）
  const count = Math.max(1, n);
  const nodes = useMemo(() => {
    const around = (i: number) => [-(i + 1) * step, -i * step, -(i - 1) * step];
    return {
      // 大字：跟著手指翻過去，離開中間就淡掉
      text: Array.from({ length: count }, (_, i) => ({
        opacity: pos.interpolate({ inputRange: around(i), outputRange: [0, 1, 0], extrapolate: "clamp" }),
        transform: [{ translateX: pos.interpolate({ inputRange: around(i), outputRange: [-W * 0.5, 0, W * 0.5], extrapolate: "clamp" }) }],
      })),
      // 小球：換一件事時跟著手指歪一下
      lean: pos.interpolate({ inputRange: [-step, 0, step], outputRange: ["-5deg", "0deg", "5deg"], extrapolate: "extend" }),
      hint: pull.interpolate({ inputRange: [10, 36], outputRange: [0, 1], extrapolate: "clamp" }),
      // 清單拉出來多少（0～1）：原本的畫面淡掉，右上角的小球浮出來
      open: sy.interpolate({ inputRange: [0, H], outputRange: [1, 0], extrapolate: "clamp" }),
      mainOut: sy.interpolate({ inputRange: [0, H * 0.5, H], outputRange: [0, 0.25, 1], extrapolate: "clamp" }),
    };
  }, [pos, sy, pull, count, step, W, H]);
  // lean 是以「目前這一件的位置」為中心算的
  const leanNow = useMemo(() => Animated.add(pos, index * step).interpolate({ inputRange: [-step, 0, step], outputRange: ["-6deg", "0deg", "6deg"], extrapolate: "clamp" }), [pos, index, step]);

  if (loading && !data) return <Loading />;
  if (!data) return <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 40, paddingHorizontal: 28 }}>{error ? <ErrorNote text={error} onRetry={refresh} /> : null}</View>;

  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  const down = data.monitor.filter((m) => !m.ok);
  const nextMs = data.milestones.filter((m) => !m.done && m.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0];
  const cur = todayEvents[index] as AppEvent | undefined;
  const done = todayEvents.filter((e) => isPast(e, nowHm)).length;
  const later = [
    ...data.events.filter((e) => e.start_date > today).map((e) => ({ key: `e${e.id}`, day: e.start_date, time: e.start_time ?? "99", title: e.title, milestone: false })),
    ...data.milestones.filter((m) => !m.done && m.due >= today).map((m) => ({ key: `m${m.id}`, day: m.due, time: "00", title: m.title, milestone: true })),
  ].sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));

  // 沒有今天的事：講之後最近的一件，都沒有就說沒有
  const fallback = later[0]
    ? { title: later[0].title, sub: `${mdShort(later[0].day)}${later[0].time.includes(":") ? ` ${later[0].time}` : ""}` }
    : { title: L("今天沒有排程", "Nothing planned"), sub: L("接下來也沒有安排", "Nothing coming up either") };

  const hour = +nowHm.slice(0, 2);
  const mood: Mood = down.length ? "worried" : refreshing ? "busy" : armed ? "curious" : n > 0 && done === n ? "happy" : hour >= 23 || hour < 6 ? "sleep" : "calm";

  const k = Math.min(1, W / 390, (H - insets.top - insets.bottom) / 720);
  const ball = Math.round(312 * k);
  const days = nextMs ? daysBetween(today, nextMs.due) : null;
  const pick = (id: string) => {
    Haptics.selectionAsync().catch(() => null);
    setPicked(id);
    setSheet(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* 清單拉出來時後面變暗一點（淺色）；深色本來就是黑的 */}
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.dim, opacity: nodes.open }} />

      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Txt size={14} lh={20} accessibilityRole="header">{L("今天", "Today")}</Txt>
        <Animated.View style={{ opacity: nodes.mainOut }}>
          <Txt size={14} lh={20} muted tab>{today ? md(today) : ""}</Txt>
        </Animated.View>
      </View>
      {/* 清單開著時，小球縮到右上角探頭 */}
      <Animated.View pointerEvents="none" style={{ position: "absolute", right: -28, top: insets.top - 20, opacity: nodes.open }}>
        <Orb size={120} shadow={false} mood={mood} />
      </Animated.View>

      <Animated.View style={{ flex: 1, opacity: nodes.mainOut }} {...pan.panHandlers} accessibilityHint={L("左右滑換一件事，往上拉看全部，往下拉更新", "Swipe sideways for the next thing, up for the list, down to refresh")}>
        {error ? <View style={{ paddingHorizontal: 28 }}><ErrorNote text={error} onRetry={refresh} /></View> : null}
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 28, top: 12, opacity: nodes.hint }}>
          <Txt size={13} muted>{refreshing ? L("更新中", "Updating") : armed ? L("放開就更新", "Release to refresh") : L("往下拉更新", "Pull to refresh")}</Txt>
        </Animated.View>

        {/* 大字：一件事一段，疊在同一個位置 */}
        <View style={{ marginTop: 40, height: 136 }}>
          {n ? (
            todayEvents.map((e, i) => (
              <Animated.View key={e.id} pointerEvents="none" accessible={i === index} accessibilityElementsHidden={i !== index} importantForAccessibility={i === index ? "yes" : "no-hide-descendants"} style={[{ position: "absolute", left: 28, right: 28, top: 0 }, nodes.text[i]]}>
                <Big>{e.title}</Big>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <Icon name="clock" size={16} color={t.muted} />
                  <Txt muted tab numberOfLines={1} style={{ flexShrink: 1 }}>
                    {e.start_time ? `${e.start_time}　${isPast(e, nowHm) ? L("過了", "done") : until(nowHm, e.start_time)}` : [L("整天", "All day"), name.get(e.project_id)].filter(Boolean).join("　")}
                  </Txt>
                </View>
              </Animated.View>
            ))
          ) : (
            <View style={{ position: "absolute", left: 28, right: 28, top: 0 }}>
              <Big>{fallback.title}</Big>
              <Txt muted tab style={{ marginTop: 8 }}>{fallback.sub}</Txt>
            </View>
          )}
        </View>

        {/* 最多三個小數字：完成幾件、離里程碑幾天、服務狀況 */}
        <View style={{ marginTop: 24, marginLeft: 28, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 20, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.line }}>
          <View accessible accessibilityLabel={L(`今天 ${n} 件事，完成 ${done}`, `${done} of ${n} done today`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="tasks" size={16} color={t.muted} />
            <Txt size={14} lh={20} tab>{done} / {n}</Txt>
          </View>
          {days != null ? (
            <View accessible accessibilityLabel={L(`下一個里程碑「${nextMs!.title}」還有 ${days} 天`, `${days} days to milestone ${nextMs!.title}`)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="flag" size={16} color={t.muted} />
              <Txt size={14} lh={20} tab>{days === 0 ? L("今天", "Today") : L(`${days} 天`, `${days}d`)}</Txt>
            </View>
          ) : null}
          {data.monitor.length ? (
            <Pressable onPress={canSee("monitor") ? () => router.navigate("/monitor") : undefined} hitSlop={12} accessibilityRole="button" accessibilityLabel={down.length ? L(`${down.length} 項服務異常`, `${down.length} services down`) : L("服務都正常", "All services up")} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Dot color={down.length ? t.bad : t.ok} size={6} />
              <Txt size={14} lh={20} tab color={down.length ? t.badText : t.ink}>{down.length ? L(`${down.length} 項異常`, `${down.length} down`) : L("正常", "OK")}</Txt>
            </Pressable>
          ) : null}
        </View>

        {/* 小球：從右下角探出來；往下拉時跟著被拉下來 */}
        <Animated.View pointerEvents="none" style={{ position: "absolute", right: Math.round(-76 * k), bottom: dockBottom(insets.bottom) + 96, transform: [{ translateY: pull }, { rotate: leanNow }] }}>
          <Orb size={ball} mood={mood} />
        </Animated.View>

        {n > 1 ? (
          <Txt size={13} lh={20} muted tab style={{ position: "absolute", left: 88, bottom: dockBottom(insets.bottom) + 14 }} accessibilityLabel={L(`第 ${index + 1} 件，共 ${n} 件`, `${index + 1} of ${n}`)}>
            {index + 1} / {n}
          </Txt>
        ) : null}
      </Animated.View>

      {/* 往上拉出來的清單 */}
      <Animated.View
        pointerEvents={sheet ? "auto" : "none"}
        accessibilityViewIsModal={sheet}
        style={{ position: "absolute", left: 8, right: 8, top: insets.top + 84, bottom: -24, borderRadius: 28, backgroundColor: t.sheet, borderWidth: 1, borderColor: t.line, paddingHorizontal: 20, transform: [{ translateY: sy }] }}
        {...sheetPan.body.panHandlers}
      >
        <View {...sheetPan.handle.panHandlers}>
          <Pressable onPress={() => setSheet(false)} accessibilityRole="button" accessibilityLabel={L("把清單滑掉", "Dismiss list")} style={{ height: 44, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: t.handle }} />
          </Pressable>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Big size={24} lines={1}>{L(`${n} 件事`, `${n} things`)}</Big>
            <Small icon="check" iconLabel={L("完成", "Done")}>{done}</Small>
          </View>
        </View>
        <ScrollView bounces={false} showsVerticalScrollIndicator={false} scrollEventThrottle={16} onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 140 }}>
          {todayEvents.map((e, i) => (
            <Line key={e.id} last={i === n - 1} onPress={() => pick(e.id)} style={{ opacity: isPast(e, nowHm) ? 0.5 : 1 }}>
              <TimeCell strong={!!e.start_time}>{e.start_time ?? L("整天", "All day")}</TimeCell>
              <Txt style={{ flex: 1 }} numberOfLines={2}>{e.title}</Txt>
              {e.id === cur?.id ? <Sig label={L("現在看的這件", "Showing now")} /> : e.end_date > today ? <Small>{L(`到 ${mdShort(e.end_date)}`, `to ${mdShort(e.end_date)}`)}</Small> : null}
            </Line>
          ))}
          {!n ? <Txt size={14} muted style={{ paddingVertical: 12 }}>{L("今天沒有排程", "Nothing planned today")}</Txt> : null}
          {later.length ? <Label>{L("接下來", "Coming up")}</Label> : null}
          {later.slice(0, 10).map((it, i, arr) => (
            <Line key={it.key} last={i === arr.length - 1}>
              <TimeCell>{mdShort(it.day)}</TimeCell>
              <Txt style={{ flex: 1 }} numberOfLines={2}>{it.title}</Txt>
              {it.milestone ? <Icon name="flag" size={16} color={t.muted} label={L("里程碑", "Milestone")} /> : null}
            </Line>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
