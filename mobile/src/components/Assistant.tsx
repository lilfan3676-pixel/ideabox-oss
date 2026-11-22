// 小球（小助手）：浮在每一頁上面，可以拖到任何位置（放手會吸到左邊或右邊），
// 點一下它用一個泡泡講「下一件事、下一步、有幾件過期」，泡泡下面的小鈕可以追問。
// 使用者 2026-11-22 要的：「讓我可以在螢幕上移來移去，可以跟我互動，然後會簡單告訴我下一步跟今天的事」。
// 要不要顯示、大小在設定頁調；位置記在這支手機上。
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pastBy, taipeiHm } from "@/lib/format";
import { L } from "@/lib/i18n";
import { glide, reduceMotion } from "@/lib/motion";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { useTheme } from "@/lib/theme";
import type { HomeData } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { Orb, type Mood } from "./Orb";
import { DOCK_H, dockBottom } from "./TabBar";
import { Txt } from "./ui";

const SIZES = { s: 48, m: 60, l: 76 } as const;
const EDGE = 14;
type Topic = "now" | "today" | "steps" | "late";

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
function until(nowHm: string, at: string): string {
  const m = toMin(at) - toMin(nowHm);
  if (m <= 0) return L("現在", "now");
  if (m < 60) return L(`還有 ${m} 分鐘`, `in ${m} min`);
  return L(`還有 ${Math.round(m / 60)} 小時`, `in ${Math.round(m / 60)} h`);
}

/** 小球要講的話（純文字，一段一行） */
export function assistantLines(home: HomeData, topic: Topic, nowHm: string): string[] {
  const today = home.today;
  const mine = home.events.filter((e) => e.start_date <= today && e.end_date >= today).sort((a, b) => (a.start_time ?? "99").localeCompare(b.start_time ?? "99"));
  const active = home.projects.filter((p) => p.status === "active");
  const name = new Map(home.projects.map((p) => [p.id, p.name]));
  if (topic === "today") {
    if (!mine.length) return [L("今天沒有排程。", "Nothing planned today.")];
    return mine.slice(0, 7).map((e) => `${e.start_time ?? L("整天", "All day")}　${e.title}${e.start_time && pastBy(e.start_time, nowHm) ? L("（過了）", " (done)") : ""}`);
  }
  if (topic === "steps") {
    const rows = active.filter((p) => p.next_step).slice(0, 6).map((p) => `${p.name}：${p.next_step}`);
    return rows.length ? rows : [L("每個專案都還沒寫下一步。", "No next steps written yet.")];
  }
  if (topic === "late") {
    const rows = active.map((p) => ({ p, n: home.todo?.[p.id]?.late ?? 0 })).filter((x) => x.n > 0).map((x) => L(`${x.p.name}：${x.n} 件過期`, `${x.p.name}: ${x.n} overdue`));
    return rows.length ? [...rows, L("到專案頁點進去可以看是哪幾件。", "Open a project to see which ones.")] : [L("沒有過期的待辦。", "Nothing overdue.")];
  }
  const out: string[] = [];
  const next = mine.find((e) => e.start_time && !pastBy(e.start_time, nowHm));
  if (next) out.push(L(`下一件是 ${next.start_time} ${next.title}，${until(nowHm, next.start_time!)}。`, `Next: ${next.start_time} ${next.title}, ${until(nowHm, next.start_time!)}.`));
  else if (mine.length) out.push(L(`今天 ${mine.length} 件事都過了。`, `All ${mine.length} things for today are done.`));
  else out.push(L("今天沒有排程。", "Nothing planned today."));
  const lead = (next && active.find((p) => p.id === next.project_id && p.next_step)) || active.find((p) => p.next_step);
  if (lead) out.push(L(`${name.get(lead.id)} 的下一步：${lead.next_step}`, `${name.get(lead.id)} next: ${lead.next_step}`));
  const late = home.overdue ?? 0;
  if (late > 0) out.push(L(`另外有 ${late} 件待辦過期了。`, `${late} to-dos are overdue.`));
  const down = home.monitor.filter((m) => !m.ok);
  if (down.length) out.push(L(`${down[0].label} 連不上。`, `${down[0].label} is down.`));
  return out;
}

export function Assistant({ lifted }: { /** 這一頁有導覽列：小球最低只能停在導覽列上面 */ lifted: boolean }) {
  const t = useTheme();
  const prefs = usePrefs();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { data, refresh } = useApi<HomeData>("/api/app/home");
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<Topic>("now");
  const size = SIZES[prefs.orbSize] ?? SIZES.m;
  const minY = insets.top + 56;
  const maxY = H - (lifted ? dockBottom(insets.bottom) + DOCK_H + 14 : Math.max(insets.bottom, 12) + 14) - size;
  const restX = prefs.orbSide === "left" ? EDGE : W - EDGE - size;
  const restY = Math.min(maxY, Math.max(minY, prefs.orbY * H));
  const pos = useRef(new Animated.ValueXY({ x: restX, y: restY })).current;
  const fade = useRef(new Animated.Value(0)).current;
  // 手勢的處理函式只建一次，最新的數字放這裡
  const live = useRef({ restX, restY, minY, maxY, W, H, size, open, refresh, moved: false });
  live.current = { ...live.current, restX, restY, minY, maxY, W, H, size, open, refresh };

  // 螢幕大小、導覽列有沒有出現、設定改了大小：回到該停的位置
  useEffect(() => {
    glide(pos.x, restX);
    glide(pos.y, restY);
  }, [restX, restY, pos]);
  useEffect(() => {
    if (reduceMotion()) fade.setValue(open ? 1 : 0);
    else Animated.timing(fade, { toValue: open ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [open, fade]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        live.current.moved = false;
      },
      onPanResponderMove: (_, g) => {
        const c = live.current;
        // 拖過就算拖（拖出去又拖回原位不算點一下）
        if (Math.abs(g.dx) + Math.abs(g.dy) >= 6) c.moved = true;
        if (!c.moved) return;
        pos.setValue({ x: c.restX + g.dx, y: Math.min(c.maxY, Math.max(c.minY, c.restY + g.dy)) });
      },
      onPanResponderRelease: (_, g) => {
        const c = live.current;
        // 幾乎沒動＝點一下：開或關泡泡
        if (!c.moved) {
          Haptics.selectionAsync().catch(() => null);
          setTopic("now");
          // 打開時順便重讀一次，講的才是最新的（它自己平常只在開 App 時讀）
          if (!c.open) c.refresh();
          setOpen(!c.open);
          return;
        }
        // 拖完：吸到比較近的那一邊，高度記下來
        const side = c.restX + g.dx + c.size / 2 < c.W / 2 ? "left" : "right";
        const y = Math.min(c.maxY, Math.max(c.minY, c.restY + g.dy));
        glide(pos.x, side === "left" ? EDGE : c.W - EDGE - c.size);
        setPrefs({ orbSide: side, orbY: y / c.H });
      },
      onPanResponderTerminate: () => {
        glide(pos.x, live.current.restX);
        glide(pos.y, live.current.restY);
      },
    }),
  ).current;

  const nowHm = taipeiHm();
  const lines = useMemo(() => (data ? assistantLines(data, topic, nowHm) : [L("還在讀資料，等我一下。", "Still loading, one moment.")]), [data, topic, nowHm]);
  if (!prefs.orb) return null;

  const down = !!data?.monitor.some((m) => !m.ok);
  const hour = +nowHm.slice(0, 2);
  const mood: Mood = down ? "worried" : open ? "curious" : hour >= 23 || hour < 6 ? "sleep" : "calm";
  const bubbleW = Math.min(300, W - 40);
  // 泡泡放在小球上面；小球太靠上面時放下面
  const above = restY > H * 0.42;
  const chips: [Topic, string][] = [["today", L("今天全部", "All today")], ["steps", L("各專案下一步", "Next steps")], ["late", L("過期的", "Overdue")]];

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}>
      {open ? <Pressable onPress={() => setOpen(false)} accessibilityLabel={L("關掉小球的泡泡", "Dismiss")} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(9,10,14,0.72)" }} /> : null}
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        accessibilityLiveRegion="polite"
        style={{
          position: "absolute",
          width: bubbleW,
          left: prefs.orbSide === "left" ? 20 : W - 20 - bubbleW,
          ...(above ? { bottom: H - restY + 12 } : { top: restY + size + 12 }),
          opacity: fade,
          transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [above ? 8 : -8, 0] }) }],
          padding: 16,
          borderRadius: 22,
          backgroundColor: t.ink,
          boxShadow: "0px 16px 34px rgba(0,0,0,0.5)",
        }}
      >
        {lines.map((x, i) => <Txt key={i} size={14.5} lh={22} color={t.bg} style={{ marginTop: i ? 4 : 0 }}>{x}</Txt>)}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {topic !== "now" ? (
            <Pressable onPress={() => setTopic("now")} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: "rgba(9,10,14,0.1)" }}>
              <Txt size={12.5} lh={18} color={t.bg}>{L("‹ 回到重點", "‹ Back")}</Txt>
            </Pressable>
          ) : null}
          {chips.filter(([k]) => k !== topic).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTopic(k)} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: t.acc }}>
              <Txt size={12.5} lh={18} color={t.onAcc}>{label}</Txt>
            </Pressable>
          ))}
          {topic === "steps" || topic === "late" ? (
            <Pressable onPress={() => { setOpen(false); router.navigate("/projects"); }} accessibilityRole="button" style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 99, backgroundColor: t.main }}>
              <Txt size={12.5} lh={18} color={t.onMain}>{L("去專案頁", "Open projects")}</Txt>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
      <Animated.View {...pan.panHandlers} accessible accessibilityRole="button" accessibilityLabel={L("小球：點一下聽今天的重點，可以拖到別的位置", "Assistant: tap for today's summary, drag to move")} style={{ position: "absolute", left: 0, top: 0, width: size, height: size, transform: pos.getTranslateTransform() }}>
        <Orb size={size} mood={mood} />
      </Animated.View>
    </View>
  );
}
