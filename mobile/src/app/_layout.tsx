import * as Notifications from "expo-notifications";
import { DarkTheme, router, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { loadSession, useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import "@/lib/push"; // 註冊「App 開著也要跳通知」
import { Launch } from "@/components/Launch";

export default function RootLayout() {
  const session = useSession();
  const t = useTheme();
  const [intro, setIntro] = useState(true); // 每次打開 App 播一次開場動畫
  const lastTap = Notifications.useLastNotificationResponse();

  useEffect(() => {
    loadSession();
  }, []);

  // 點了推送通知：打開「今天」
  useEffect(() => {
    if (!session || !lastTap || lastTap.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    router.navigate("/");
  }, [lastTap, session]);

  const ready = session !== undefined; // 還在讀鑰匙圈時只有開場動畫（黑底）

  // 標題列、返回鍵、彈出頁用 App 自己的黑底配色
  const navTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, primary: t.accent, background: t.bgA, card: t.bgA, text: t.text, border: t.sep } };
  return (
    <View style={{ flex: 1, backgroundColor: "#000000" }}>
      {ready ? (
        <ThemeProvider value={navTheme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bgA } }}>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="settings"
                options={{
                  presentation: "formSheet",
                  // 不用原生標題列：標題放在頁面裡跟著捲動
                  headerShown: false,
                  sheetGrabberVisible: true,
                  sheetAllowedDetents: [0.75, 1],
                }}
              />
            </Stack.Protected>
            <Stack.Screen name="pair" options={{ gestureEnabled: false }} />
          </Stack>
        </ThemeProvider>
      ) : null}
      {/* 每次打開 App 播一次；蓋在最上面，播完淡出 */}
      {intro ? <Launch onDone={() => setIntro(false)} /> : null}
    </View>
  );
}
