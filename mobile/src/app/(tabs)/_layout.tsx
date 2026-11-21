import * as Haptics from "expo-haptics";
import { useSegments } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dockBottom, Menu } from "@/components/Menu";
import { RoundButton } from "@/components/ui";
import { L } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { registerPush } from "@/lib/push";
import { useTheme } from "@/lib/theme";

// 沒有 iPhone 的分頁列：換頁靠左下角那顆圓鈕打開的選單（Menu）。
// 合夥人能看哪些畫面由選單過濾（Session.tabs）。專案詳細頁有自己的返回鈕，不放選單鈕。
export default function TabsLayout() {
  const t = useTheme();
  usePrefs();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const detail = (useSegments() as string[]).includes("[slug]");
  // 配對完第一次進來問要不要開通知；之後每次開 App 更新一次推送地址（換手機、重裝都會變）
  useEffect(() => {
    registerPush(true).catch(() => null);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, animation: "fade", sceneStyle: { backgroundColor: t.bg } }}>
        <Tabs.Screen name="(today)" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="projects" />
        <Tabs.Screen name="monitor" />
        <Tabs.Screen name="office" />
        <Tabs.Screen name="settings" />
      </Tabs>
      {detail ? null : (
        <View style={{ position: "absolute", left: 24, bottom: dockBottom(insets.bottom) }}>
          <RoundButton
            icon="grid"
            label={L("打開選單", "Open menu")}
            size={48}
            solid
            onPress={() => {
              Haptics.selectionAsync().catch(() => null);
              setMenu(true);
            }}
          />
        </View>
      )}
      <Menu open={menu} onClose={() => setMenu(false)} />
    </View>
  );
}
