// 玻璃珠放射選單：中間是「今天」，周圍一顆一個畫面，細線連起來；目前所在的那顆是霓虹黃圓盤
// 合夥人的手機只會看到他有權限的畫面
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Line, Pattern, Rect } from "react-native-svg";
import { reduceMotion, SPRING } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { pageOf, PAGES } from "./Dock";

const LIME = "#e6f24b";

/** 每顆珠子的玻璃質感（深色底＋透出來的顏色） */
const GLASS: Record<string, string> = {
  today: "radial-gradient(circle at 78% 50%, rgba(150,140,220,0.9) 0%, rgba(150,140,220,0) 45%), radial-gradient(circle at 30% 40%, #f0d2bc 0%, #d9b49a 45%, #8a6a5c 100%)",
  calendar: "radial-gradient(circle at 60% 60%, #5f73c8 0%, rgba(95,115,200,0) 55%), radial-gradient(circle at 35% 30%, #a9b4d6 0%, #6d7aa6 55%, #2f3760 100%)",
  projects: "radial-gradient(circle at 62% 38%, #a8f02e 0%, #5fae14 34%, #10200a 72%, #050805 100%)",
  monitor: "radial-gradient(circle at 40% 35%, #a39a6a 0%, #7d7650 55%, #4a4630 100%)",
  office: "radial-gradient(circle at 50% 12%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 26%), radial-gradient(circle at 50% 60%, #4a35c8 0%, #23186e 50%, #07061a 100%)",
  settings: "radial-gradient(circle at 50% 105%, #ffb02e 0%, #e0401c 28%, #3a0c08 58%, #060606 100%)",
};

type Item = { key: string; label: string; icon: string; go: () => void };

export function RadialMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const current = pageOf(usePathname());
  const tabs = useSession()?.tabs;

  // 打開：黑幕淡入，中間那顆先長出來，周圍的珠子一顆接一顆從中間彈出去；關掉：全部縮回中間
  const [shown, setShown] = useState(open);
  const veil = useRef(new Animated.Value(0)).current;
  const orbs = useRef(Array.from({ length: 8 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    if (open) setShown(true);
    if (reduceMotion()) {
      veil.setValue(open ? 1 : 0);
      orbs.forEach((o) => o.setValue(open ? 1 : 0));
      if (!open) setShown(false);
      return;
    }
    const anim = open
      ? Animated.parallel([
          Animated.timing(veil, { toValue: 1, duration: 180, useNativeDriver: true }),
          Animated.stagger(38, orbs.map((o) => Animated.spring(o, { toValue: 1, ...SPRING }))),
        ])
      : Animated.parallel([
          Animated.timing(veil, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ...orbs.map((o) => Animated.timing(o, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), useNativeDriver: true })),
        ]);
    anim.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => anim.stop();
  }, [open, veil, orbs]);
  const can = (k: string) => k === "today" || !tabs || tabs.includes(k);

  const go = (path: string) => () => {
    Haptics.selectionAsync().catch(() => null);
    onClose();
    // 「設定」是彈出頁：要等選單（Modal）收完才開，不然 iOS 會因為前一個畫面還在收合而不顯示
    if (path === "/settings") setTimeout(() => router.navigate(path as never), 420);
    else router.navigate(path as never);
  };
  const center: Item = { ...PAGES[0], go: go("/") };
  const around: Item[] = [
    ...PAGES.slice(1).filter((p) => can(p.key)).map((p) => ({ ...p, go: go(p.path) })),
    { key: "settings", label: "設定", icon: "gearshape", go: go("/settings") },
  ];

  const cx = W / 2;
  const cy = H * 0.47;
  const R = Math.min(118, W * 0.3);
  const pos = around.map((_, i) => {
    const a = (-90 + (360 / around.length) * i) * (Math.PI / 180);
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  return (
    <Modal visible={open || shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "#000000", opacity: veil }} accessibilityViewIsModal>
        <Svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
          <Defs>
            <Pattern id="dots" width={9} height={9} patternUnits="userSpaceOnUse">
              <Circle cx={1} cy={1} r={0.8} fill="rgba(255,255,255,0.12)" />
            </Pattern>
          </Defs>
          <Rect width={W} height={H} fill="url(#dots)" />
        </Svg>
        {/* 連到每顆珠子的細線：等珠子差不多到位才浮出來 */}
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, opacity: orbs[Math.min(around.length, orbs.length - 1)] }}>
          <Svg width={W} height={H}>
            {pos.map((p, i) => <Line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />)}
            <Circle cx={cx} cy={cy} r={53} fill="#000000" stroke="#aeb93a" strokeWidth={2.5} />
          </Svg>
        </Animated.View>

        <Text accessibilityRole="header" style={{ position: "absolute", left: 22, top: insets.top + 14, fontSize: 27, fontWeight: "700", color: "#ffffff" }}>選單</Text>

        <Orb item={center} x={cx} y={cy} size={92} on={current.key === "today"} v={orbs[0]} fromX={0} fromY={0} />
        {around.map((it, i) => <Orb key={it.key} item={it} x={pos[i].x} y={pos[i].y} size={60} on={current.key === it.key} v={orbs[Math.min(i + 1, orbs.length - 1)]} fromX={cx - pos[i].x} fromY={cy - pos[i].y} />)}

        <View style={{ position: "absolute", left: 18, right: 18, bottom: Math.max(insets.bottom, 12) + 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="關閉選單" style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "#0c0c0d", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}>
            <SymbolView name="xmark" size={18} tintColor="#ffffff" weight="bold" />
          </Pressable>
          <View style={{ height: 30, paddingHorizontal: 16, borderRadius: 15, backgroundColor: LIME, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#111111" }}>目前在：{current.label}</Text>
          </View>
          <View style={{ width: 52, height: 52 }} />
        </View>
      </Animated.View>
    </Modal>
  );
}

function Orb({ item, x, y, size, on, v, fromX, fromY }: { item: Item; x: number; y: number; size: number; on: boolean; v: Animated.Value; fromX: number; fromY: number }) {
  // 目前所在的畫面：霓虹黃圓盤，中間一顆深色的心
  const outer = on ? size + 16 : size;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: x - outer / 2,
        top: y - outer / 2,
        opacity: v.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: "clamp" }),
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
        ],
      }}
    >
    <Pressable
      onPress={item.go}
      accessibilityRole="button"
      accessibilityLabel={on ? `${item.label}（目前所在）` : item.label}
      hitSlop={8}
      style={({ pressed }) => ({
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? LIME : "#0a0a0b",
        borderWidth: on ? 0 : 1.5,
        borderColor: "rgba(255,255,255,0.4)",
        experimental_backgroundImage: on ? undefined : GLASS[item.key],
        boxShadow: on ? "0px 0px 28px rgba(230,242,75,0.35)" : "inset 0px -6px 12px rgba(0,0,0,0.5)",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      {on ? (
        <View style={{ width: size * 0.74, height: size * 0.74, borderRadius: size, backgroundColor: "#2a2b22", alignItems: "center", justifyContent: "center" }}>
          <SymbolView name={item.icon as never} size={size * 0.36} tintColor="#ffffff" weight="medium" />
        </View>
      ) : (
        <SymbolView name={item.icon as never} size={size * 0.38} tintColor="#ffffff" weight="medium" />
      )}
    </Pressable>
    </Animated.View>
  );
}
