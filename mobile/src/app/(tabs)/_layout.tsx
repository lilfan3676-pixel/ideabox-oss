import { Tabs } from "expo-router/js-tabs";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Dock } from "@/components/Dock";
import { RadialMenu } from "@/components/RadialMenu";
import { registerPush } from "@/lib/push";

// App 2.0：不用 iPhone 的分頁列了。換頁靠左下角打開的玻璃珠選單（RadialMenu），
// 底部是懸浮的三顆按鈕（Dock）。合夥人能看哪些畫面由選單過濾（Session.tabs）。
export default function TabsLayout() {
  const [menu, setMenu] = useState(false);
  // 配對完第一次進來問要不要開通知；之後每次開 App 更新一次推送地址（換手機、重裝都會變）
  useEffect(() => {
    registerPush(true).catch(() => null);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      <Tabs tabBar={() => null} screenOptions={{ headerShown: false, animation: "fade", sceneStyle: { backgroundColor: "#000000" } }}>
        <Tabs.Screen name="(today)" />
        <Tabs.Screen name="calendar" />
        <Tabs.Screen name="projects" />
        <Tabs.Screen name="monitor" />
        <Tabs.Screen name="office" />
      </Tabs>
      <Dock onMenu={() => setMenu(true)} />
      <RadialMenu open={menu} onClose={() => setMenu(false)} />
    </View>
  );
}
