import { useSegments } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { View } from "react-native";
import { Assistant } from "@/components/Assistant";
import { TabBar } from "@/components/TabBar";
import { usePrefs } from "@/lib/prefs";
import { registerPush } from "@/lib/push";
import { useTheme } from "@/lib/theme";

// 換頁靠底部懸浮的圖示導覽列（TabBar）；設定是每一頁右上角的圖示，不在導覽列裡。
// 專案詳細頁與設定頁有自己的返回鈕，不放導覽列。小球（Assistant）浮在所有頁面上面。
export default function TabsLayout() {
  const t = useTheme();
  usePrefs();
  const seg = useSegments() as string[];
  const bare = seg.includes("[slug]") || seg.includes("settings");
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
      {bare ? null : <TabBar />}
      <Assistant lifted={!bare} />
    </View>
  );
}
