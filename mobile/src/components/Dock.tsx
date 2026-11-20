// 底部懸浮的三顆：左＝打開選單、中＝這一頁的動作（今天：拉出全部清單）、右＝重新整理
// 取代原本的 iPhone 分頁列（App 2.0 的 B 版設計）
import * as Haptics from "expo-haptics";
import { usePathname } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useRef } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dockRefresh, toggleSheet, useSheet } from "@/lib/dock";
import { reduceMotion } from "@/lib/motion";

export const PAGES: { key: string; path: string; label: string; icon: string }[] = [
  { key: "today", path: "/", label: "今天", icon: "sun.max" },
  { key: "calendar", path: "/calendar", label: "月曆", icon: "calendar" },
  { key: "projects", path: "/projects", label: "專案", icon: "folder" },
  { key: "monitor", path: "/monitor", label: "監控", icon: "waveform.path.ecg" },
  { key: "office", path: "/office", label: "辦公室", icon: "person.3" },
];

export const pageOf = (pathname: string) => PAGES.find((p) => p.path !== "/" && pathname.startsWith(p.path)) ?? PAGES[0];

export function Dock({ onMenu }: { onMenu: () => void }) {
  const insets = useSafeAreaInsets();
  const page = pageOf(usePathname());
  const sheet = useSheet();
  const today = page.key === "today";
  const tap = (fn: () => void) => () => {
    Haptics.selectionAsync().catch(() => null);
    fn();
  };
  const bottom = Math.max(insets.bottom, 12) + 6;
  // 按重新整理：箭頭轉一圈
  const spin = useRef(new Animated.Value(0)).current;
  const refresh = () => {
    dockRefresh();
    if (reduceMotion()) return;
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };
  return (
    <>
    {/* 清單捲到按鈕後面時漸漸變黑，按鈕才看得清楚（今天頁是整面漸層，不用） */}
    {today ? null : <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bottom + 110, experimental_backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.86) 55%, #000000 100%)" }} />}
    <View pointerEvents="box-none" style={{ position: "absolute", left: 18, right: 18, bottom, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Pressable
        onPress={tap(onMenu)}
        accessibilityRole="button"
        accessibilityLabel="打開選單"
        style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: today ? "rgba(0,0,0,0.42)" : "#0c0c0d", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
      >
        <SymbolView name="circle.grid.2x2" size={20} tintColor="#ffffff" weight="semibold" />
      </Pressable>

      {today ? (
        <Pressable
          onPress={tap(toggleSheet)}
          accessibilityRole="button"
          accessibilityLabel={sheet ? "收起清單" : "往上拉看今天全部的事"}
          style={({ pressed }) => ({ width: 104, height: 44, borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
        >
          <SymbolView name={sheet ? "chevron.down" : "chevron.up"} size={16} tintColor="#ffffff" weight="bold" />
        </Pressable>
      ) : (
        <View style={{ height: 30, paddingHorizontal: 16, borderRadius: 15, backgroundColor: "#1c1c1e", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#ffffff" }}>{page.label}</Text>
        </View>
      )}

      <Pressable
        onPress={tap(refresh)}
        accessibilityRole="button"
        accessibilityLabel="重新整理"
        style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
      >
        <Animated.View style={{ transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
          <SymbolView name="arrow.clockwise" size={20} tintColor="#000000" weight="bold" />
        </Animated.View>
      </Pressable>
    </View>
    </>
  );
}
