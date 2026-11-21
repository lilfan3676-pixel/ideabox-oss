// 小球：App 的主角。白底是黑球、黑底是白球，兩條直線是眼睛（就是 ib 標誌裡 i 和 b 的那兩條）。
// 會呼吸、會眨眼，表情跟著狀況換；開了「減少動態效果」就不動。
import { useEffect, useRef } from "react";
import { Animated, Easing, View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { reduceMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";

export type Mood = "calm" | "curious" | "busy" | "happy" | "worried" | "sleep";

// 眼睛的尺寸都是球直徑的比例：[寬, 左眼高, 右眼高, 上緣, 左眼角度, 右眼角度]
const EYES: Record<Exclude<Mood, "happy">, [number, number, number, number, number, number]> = {
  calm: [0.077, 0.27, 0.27, 0.295, -8, -8],
  curious: [0.085, 0.25, 0.3, 0.25, -8, -8],
  busy: [0.088, 0.13, 0.13, 0.38, -4, -4],
  worried: [0.081, 0.24, 0.24, 0.34, 16, -22],
  sleep: [0.11, 0.04, 0.04, 0.48, 0, 0],
};
const STAR = "M12 0C12.9 7.2 16.8 11.1 24 12C16.8 12.9 12.9 16.8 12 24C11.1 16.8 7.2 12.9 0 12C7.2 11.1 11.1 7.2 12 0Z";

export function Orb({ size, mood = "calm", shadow = true, still, style, label }: { size: number; mood?: Mood; shadow?: boolean; still?: boolean; style?: ViewStyle; label?: string }) {
  const t = useTheme();
  const breath = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (still || reduceMotion()) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.delay(3400),
        Animated.timing(blink, { toValue: 0.1, duration: 90, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 130, useNativeDriver: true }),
      ]),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [breath, blink, still]);

  const centers = [0.39, 0.545];
  let eyes;
  if (mood === "happy") {
    const s = size * 0.2;
    eyes = centers.map((c, i) => (
      <View key={i} style={{ position: "absolute", left: size * c - s / 2 + (i ? size * 0.03 : -size * 0.03), top: size * 0.33 }}>
        <Svg width={s} height={s} viewBox="0 0 24 24"><Path d={STAR} fill={t.eye} /></Svg>
      </View>
    ));
  } else {
    const [w, hl, hr, top, rl, rr] = EYES[mood];
    eyes = centers.map((c, i) => {
      const ew = size * w;
      const eh = size * (i ? hr : hl);
      return <View key={i} style={{ position: "absolute", left: size * c - ew / 2, top: size * top, width: ew, height: eh, borderRadius: Math.min(ew, eh) / 2, backgroundColor: t.eye, transform: [{ rotate: `${i ? rr : rl}deg` }] }} />;
    });
  }
  return (
    <Animated.View
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.ballBase, experimental_backgroundImage: t.ball, boxShadow: shadow ? t.ballShadow : undefined },
        style,
        { transform: [...((style?.transform as never[]) ?? []), { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }, { rotate: mood === "curious" ? "9deg" : "0deg" }] },
      ]}
    >
      <Animated.View style={{ flex: 1, transform: [{ scaleY: mood === "sleep" ? 1 : blink }] }}>{eyes}</Animated.View>
    </Animated.View>
  );
}
