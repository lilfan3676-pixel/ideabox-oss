// 左右滑換一個（專案頁換專案、監控頁換產品）：內容跟著手指走，放手後滑出去、下一個從另一邊滑進來。
// 放在可以上下捲的頁面裡：橫的手勢搶在頁面開始捲之前接手（判斷見 lib/gesture.ts），接手後把頁面的上下捲鎖住，放手才解開；直的照樣捲。
// 用法：const swipe = useSwipe(...)；<Page swiping={swipe.dragging}>，裡面包一層 <View {...swipe.handlers}>。
import * as Haptics from "expo-haptics";
import { useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, useWindowDimensions } from "react-native";
import { axisOf } from "./gesture";
import { reduceMotion, SNAP } from "./motion";

export function useSwipe(count: number, index: number, setIndex: (i: number) => void) {
  const { width: W } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  // 正在左右滑：頁面拿這個去鎖住上下捲
  const [dragging, lock] = useState(false);
  const live = useRef({ count, index, setIndex, W, lock });
  live.current = { count, index, setIndex, W, lock };

  const pan = useRef(
    PanResponder.create({
      // 用 capture：頁面的上下捲大約動 10 點就會把觸控收走，要比它早接手
      onMoveShouldSetPanResponderCapture: (_, g) => live.current.count > 1 && axisOf(g.dx, g.dy) === "x",
      onPanResponderGrant: () => live.current.lock(true),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const c = live.current;
        if (reduceMotion()) return;
        // 第一個再往右、最後一個再往左：拉得動但很緊
        const edge = (c.index === 0 && g.dx > 0) || (c.index === c.count - 1 && g.dx < 0);
        x.setValue(edge ? g.dx * 0.25 : g.dx);
      },
      onPanResponderRelease: (_, g) => {
        const c = live.current;
        c.lock(false);
        const d = g.dx < -c.W * 0.18 || g.vx < -0.45 ? 1 : g.dx > c.W * 0.18 || g.vx > 0.45 ? -1 : 0;
        const to = c.index + d;
        if (!d || to < 0 || to >= c.count) {
          Animated.spring(x, { toValue: 0, ...SNAP }).start();
          return;
        }
        Haptics.selectionAsync().catch(() => null);
        if (reduceMotion()) {
          c.setIndex(to);
          return;
        }
        Animated.timing(x, { toValue: -d * c.W * 0.5, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
          c.setIndex(to);
          x.setValue(d * c.W * 0.5);
          Animated.spring(x, { toValue: 0, ...SNAP }).start();
        });
      },
      onPanResponderTerminate: () => {
        live.current.lock(false);
        Animated.spring(x, { toValue: 0, ...SNAP }).start();
      },
    }),
  ).current;

  const style = useMemo(
    () => ({ opacity: x.interpolate({ inputRange: [-W * 0.5, 0, W * 0.5], outputRange: [0, 1, 0], extrapolate: "clamp" }), transform: [{ translateX: x }] }),
    [x, W],
  );
  return { handlers: pan.panHandlers, style, dragging };
}
