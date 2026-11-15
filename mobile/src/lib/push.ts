// 推送通知：要權限 → 拿 Expo 推送地址 → 交給 ideabox
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

// App 開著的時候收到推送也要跳橫幅
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = { ok: true } | { ok: false; reason: "simulator" | "denied" | "no_project" | "failed"; message: string };

export async function pushStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

export async function registerPush(ask: boolean): Promise<PushResult> {
  if (!Device.isDevice) return { ok: false, reason: "simulator", message: "模擬器收不到推送，裝到 iPhone 上才會有。" };
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && ask && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: "denied", message: "通知沒有開。到 iPhone「設定 → 通知 → ideabox」打開。" };
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "ideabox", importance: Notifications.AndroidImportance.HIGH });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: "no_project", message: "App 還沒連到 Expo 專案（要先執行 eas init）。" };
  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api("/api/app/device", { method: "POST", body: JSON.stringify({ push_token: data }) });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed", message: "沒辦法開啟推送，等一下再試。" };
  }
}

export async function disablePush(): Promise<void> {
  await api("/api/app/device", { method: "POST", body: JSON.stringify({ push_token: null }) });
}
