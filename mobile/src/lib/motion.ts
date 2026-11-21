// 動畫的小工具：都用 React Native 內建的 Animated（走原生驅動），不另外裝動畫套件。
// 手機開了「減少動態效果」就不動，直接到位。
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

let reduce = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduce = v;
  })
  .catch(() => null);
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
  reduce = v;
});
export const reduceMotion = () => reduce;

export const SPRING = { useNativeDriver: true, damping: 17, stiffness: 190, mass: 0.9 } as const;
/** 跟手的東西放手後用的彈簧：比 SPRING 緊，很快到位、只晃一點點（翻頁、拉出來的清單） */
export const SNAP = { useNativeDriver: true, damping: 28, stiffness: 300, mass: 1 } as const;

/** 讓一個值彈到定位；開了「減少動態效果」就直接到位 */
export function glide(v: Animated.Value, toValue: number) {
  if (reduce) v.setValue(toValue);
  else Animated.spring(v, { toValue, ...SNAP }).start();
}

/** 開關一個浮出來的東西：打開用彈簧、關掉快一點；關的動畫跑完才真的拿掉（mounted） */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (open) setMounted(true);
    if (reduce) {
      v.setValue(open ? 1 : 0);
      if (!open) setMounted(false);
      return;
    }
    const anim = open
      ? Animated.spring(v, { toValue: 1, ...SPRING })
      : Animated.timing(v, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => anim.stop();
  }, [open, v]);
  return { mounted: mounted || open, v };
}

/** 進場：從下面一點點浮上來，delay 用來一個接一個 */
export function useRise(delay = 0) {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    const anim = Animated.timing(v, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] };
}
