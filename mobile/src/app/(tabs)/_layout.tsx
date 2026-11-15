import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect } from "react";
import { View } from "react-native";
import { Assistant } from "@/components/Assistant";
import { registerPush } from "@/lib/push";
import { useTheme } from "@/lib/theme";

export default function TabsLayout() {
  const t = useTheme();
  // 配對完第一次進來問要不要開通知；之後每次開 App 更新一次推送地址（換手機、重裝都會變）
  useEffect(() => {
    registerPush(true).catch(() => null);
  }, []);

  // 小助手浮在所有分頁上面（右下角）
  return (
    <View style={{ flex: 1 }}>
    <NativeTabs tintColor={t.accent}>
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Label>今天</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "sun.max", selected: "sun.max.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar">
        <NativeTabs.Trigger.Label>月曆</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Label>專案</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "folder", selected: "folder.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ideas">
        <NativeTabs.Trigger.Label>點子</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "lightbulb", selected: "lightbulb.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="office">
        <NativeTabs.Trigger.Label>辦公室</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person.3", selected: "person.3.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
    <Assistant />
    </View>
  );
}
