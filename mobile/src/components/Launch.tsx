// 開場：粒子從四周旋進中心、收成 ib 標誌 → b 的圈和 i 的點淡掉，剩兩條直線 → 變成小球，滑到今天頁右下角。
// 全部用程式畫（不是影片），所以會跟著深淺色換：淺色是黑粒子黑球，深色是白粒子白球。
// 每次打開 App 播一次（約 2.6 秒），點一下跳過；開了「減少動態效果」就不播。
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { getPrefs } from "@/lib/prefs";
import { DOCK_H, dockBottom, LOGO, LOGO_INV } from "./TabBar";
import { Orb } from "./Orb";

const SIZE = 140;
const DOTS = 170;

/** 固定的亂數（每次開場粒子的位置都一樣，不會有時好看有時醜） */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** toToday：已經配對、會進到今天頁，小球才滑到進度環中間；還沒配對就原地淡出 */
export function Launch({ onDone, toToday }: { onDone: () => void; toToday: boolean }) {
  const t = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [gone, setGone] = useState(false);
  const gather = useRef(new Animated.Value(0)).current; // 粒子聚攏
  const logo = useRef(new Animated.Value(0)).current; // 標誌出現
  const swap = useRef(new Animated.Value(0)).current; // 標誌換成小球
  const move = useRef(new Animated.Value(0)).current; // 小球滑到定位
  const veil = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);
  // onDone 每次重畫都是新的函式：放在 ref 裡，動畫才不會因為外層重畫而重來
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const goRef = useRef(toToday);
  goRef.current = toToday;

  const finish = (fast: boolean) => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(veil, { toValue: 0, duration: fast ? 160 : 260, useNativeDriver: true }).start(() => {
      setGone(true);
      doneRef.current();
    });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (reduceMotion()) {
      finishRef.current(true);
      return;
    }
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(gather, { toValue: 1, duration: 1250, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(logo, { toValue: 1, duration: 380, delay: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.delay(320),
      Animated.timing(swap, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(120),
    ]);
    anim.start(({ finished: ok }) => {
      if (!ok) return;
      if (!goRef.current) return finishRef.current(false);
      Animated.parallel([
        Animated.timing(move, { toValue: 1, duration: 560, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(veil, { toValue: 0, duration: 420, delay: 240, useNativeDriver: true }),
      ]).start(() => {
        finished.current = true;
        setGone(true);
        doneRef.current();
      });
    });
    // 萬一動畫沒跑起來，最多等 5 秒就放行
    const timer = setTimeout(() => finishRef.current(true), 5000);
    return () => {
      anim.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 粒子：從外圈的隨機位置出發，落到標誌那個圓裡；每顆出發的時間差一點，整群邊收邊轉
  const dots = useMemo(() => {
    const rnd = seeded(20261121);
    const far = Math.hypot(W, H) / 2;
    return Array.from({ length: DOTS }, () => {
      const a0 = rnd() * Math.PI * 2;
      const r0 = far * (0.45 + rnd() * 0.6);
      const a1 = a0 + 1.1 + rnd() * 0.9; // 往內的同時繞一小段
      const r1 = (SIZE / 2) * Math.sqrt(rnd()) * 0.92;
      const d = rnd() * 0.3; // 出發的時間
      const size = 2.5 + rnd() * 3;
      const range = [d, d + 0.7];
      return {
        size,
        style: {
          opacity: gather.interpolate({ inputRange: [d, d + 0.12, d + 0.62, d + 0.7], outputRange: [0, 0.9, 0.9, 0], extrapolate: "clamp" as const }),
          transform: [
            { translateX: gather.interpolate({ inputRange: range, outputRange: [Math.cos(a0) * r0, Math.cos(a1) * r1], extrapolate: "clamp" as const }) },
            { translateY: gather.interpolate({ inputRange: range, outputRange: [Math.sin(a0) * r0, Math.sin(a1) * r1], extrapolate: "clamp" as const }) },
          ],
        },
      };
    });
  }, [gather, W, H]);

  if (gone) return null;
  // 小球最後落在「小助手」平常停的位置（跟 components/Assistant.tsx 同一套算法：停在哪一邊、多高、多大都照設定）
  const prefs = getPrefs();
  const ball = ({ s: 48, m: 60, l: 76 } as const)[prefs.orbSize] ?? 60;
  const maxY = H - (dockBottom(insets.bottom) + DOCK_H + 14) - ball;
  const restY = Math.min(maxY, Math.max(insets.top + 56, prefs.orbY * H));
  const tx = (prefs.orbSide === "left" ? 14 : W - 14 - ball) + ball / 2 - W / 2;
  const ty = restY + ball / 2 - H / 2;
  const center = { position: "absolute" as const, left: W / 2 - SIZE / 2, top: H / 2 - SIZE / 2 };
  return (
    <Pressable onPress={() => finish(true)} accessibilityRole="button" accessibilityLabel={L("ideabox 開場動畫，點一下跳過", "ideabox intro. Tap to skip")} style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, opacity: veil }]} />
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: W / 2, top: H / 2, opacity: veil, transform: [{ rotate: gather.interpolate({ inputRange: [0, 1], outputRange: ["-18deg", "0deg"] }) }] }}>
        {dots.map((d, i) => (
          <Animated.View key={i} style={[{ position: "absolute", left: -d.size / 2, top: -d.size / 2, width: d.size, height: d.size, borderRadius: d.size / 2, backgroundColor: t.ink }, d.style]} />
        ))}
      </Animated.View>
      <Animated.View
        style={[center, {
          opacity: Animated.multiply(swap, veil.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] })),
          transform: [
            { translateX: move.interpolate({ inputRange: [0, 1], outputRange: [0, tx] }) },
            { translateY: move.interpolate({ inputRange: [0, 1], outputRange: [0, ty] }) },
            { scale: move.interpolate({ inputRange: [0, 1], outputRange: [1, ball / SIZE] }) },
          ],
        }]}
      >
        <Orb size={SIZE} still shadow={false} />
      </Animated.View>
      <Animated.View style={[center, { opacity: Animated.multiply(logo, swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })), transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }]}>
        <Image source={t.dark ? LOGO_INV : LOGO} style={{ width: SIZE, height: SIZE }} />
      </Animated.View>
    </Pressable>
  );
}
