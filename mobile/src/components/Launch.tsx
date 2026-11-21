// 開場：ib 標誌 → b 的圈和 i 的點淡掉，剩兩條直線 → 變成小球，滑到今天頁右下角的位置。
// 每次打開 App 播一次（約 1.6 秒），點一下跳過；開了「減少動態效果」就不播。
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { dockBottom, LOGO, LOGO_INV } from "./Menu";
import { Orb } from "./Orb";

const SIZE = 140;

/** toToday：已經配對、會進到今天頁，小球才滑到右下角；還沒配對就原地淡出 */
export function Launch({ onDone, toToday }: { onDone: () => void; toToday: boolean }) {
  const t = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [gone, setGone] = useState(false);
  const logo = useRef(new Animated.Value(0)).current; // 標誌出現
  const swap = useRef(new Animated.Value(0)).current; // 標誌換成小球
  const move = useRef(new Animated.Value(0)).current; // 小球滑到定位
  const veil = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

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
  const goRef = useRef(toToday);
  goRef.current = toToday;
  // onDone 每次重畫都是新的函式：放在 ref 裡，動畫才不會因為外層重畫而重來
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (reduceMotion()) {
      finishRef.current(true);
      return;
    }
    const anim = Animated.sequence([
      Animated.timing(logo, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(420),
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
    // 萬一動畫沒跑起來，最多等 4 秒就放行
    const timer = setTimeout(() => finishRef.current(true), 4000);
    return () => {
      anim.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (gone) return null;
  // 今天頁那顆小球的位置與大小（跟今天頁同一套算法）
  const k = Math.min(1, W / 390, (H - insets.top - insets.bottom) / 720);
  const ball = Math.round(312 * k);
  const tx = W + Math.round(76 * k) - ball / 2 - W / 2;
  const ty = H - (dockBottom(insets.bottom) + 96) - ball / 2 - H / 2;
  const center = { position: "absolute" as const, left: W / 2 - SIZE / 2, top: H / 2 - SIZE / 2 };
  return (
    <Pressable onPress={() => finish(true)} accessibilityRole="button" accessibilityLabel={L("ideabox 開場動畫，點一下跳過", "ideabox intro. Tap to skip")} style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, opacity: veil }]} />
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
      <Animated.View style={[center, { opacity: Animated.multiply(logo, swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })), transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
        <Image source={t.dark ? LOGO_INV : LOGO} style={{ width: SIZE, height: SIZE }} />
      </Animated.View>
    </Pressable>
  );
}
