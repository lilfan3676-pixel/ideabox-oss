import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect } from "react";
import { View } from "react-native";
import { Assistant } from "@/components/Assistant";
import { registerPush } from "@/lib/push";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/lib/session";

export default function TabsLayout() {
  const t = useTheme();
  // 合夥人的手機只顯示他有權限的分頁（舊的配對沒有 tabs＝全部顯示）
  const tabs = useSession()?.tabs;
  const hide = (k: string) => !!tabs && !tabs.includes(k);
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
      <NativeTabs.Trigger name="calendar" hidden={hide("calendar")}>
        <NativeTabs.Trigger.Label>月曆</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="projects" hidden={hide("projects")}>
        <NativeTabs.Trigger.Label>專案</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "folder", selected: "folder.fill" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="monitor" hidden={hide("monitor")}>
        <NativeTabs.Trigger.Label>監控</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "waveform.path.ecg", selected: "waveform.path.ecg" }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="office" hidden={hide("office")}>
        <NativeTabs.Trigger.Label>辦公室</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person.3", selected: "person.3.fill" }} />
      </NativeTabs.Trigger>
    </NativeTabs>
    <Assistant />
    </View>
  );
}
