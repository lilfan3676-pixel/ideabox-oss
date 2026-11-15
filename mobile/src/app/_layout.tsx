import * as Notifications from "expo-notifications";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { loadSession, useSession } from "@/lib/session";
import { loadTheme, useTheme } from "@/lib/theme";
import "@/lib/push"; // 註冊「App 開著也要跳通知」

export default function RootLayout() {
  const session = useSession();
  const t = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  const lastTap = Notifications.useLastNotificationResponse();

  useEffect(() => {
    loadSession();
    loadTheme().finally(() => setThemeReady(true));
  }, []);

  // 點了推送通知：打開「今天」
  useEffect(() => {
    if (!session || !lastTap || lastTap.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    router.navigate("/");
  }, [lastTap, session]);

  if (session === undefined || !themeReady) return null; // 還在讀鑰匙圈，先停在啟動畫面

  // 標題列、返回鍵、彈出頁跟著 ideabox 的主題（不是 iPhone 的淺色／深色）
  const nav = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...nav, colors: { ...nav.colors, primary: t.accent, background: t.bgA, card: t.bgA, text: t.text, border: t.sep } };
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bgA } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="settings"
            options={{
              presentation: "formSheet",
              headerShown: true,
              title: "設定",
              sheetGrabberVisible: true,
              sheetAllowedDetents: [0.75, 1],
              headerTintColor: t.accent,
              headerTitleStyle: { color: t.text },
              headerStyle: { backgroundColor: t.bgA },
              headerShadowVisible: false,
            }}
          />
        </Stack.Protected>
        <Stack.Screen name="pair" options={{ gestureEnabled: false }} />
      </Stack>
    </ThemeProvider>
  );
}
