import * as Notifications from "expo-notifications";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Launch } from "@/components/Launch";
import { loadPrefs } from "@/lib/prefs";
import { loadSession, useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import "@/lib/push"; // 註冊「App 開著也要跳通知」

export default function RootLayout() {
  const session = useSession();
  const t = useTheme();
  const [intro, setIntro] = useState(true); // 每次打開 App 播一次開場
  const [prefsReady, setPrefsReady] = useState(false);
  const lastTap = Notifications.useLastNotificationResponse();

  useEffect(() => {
    loadSession();
    loadPrefs().finally(() => setPrefsReady(true));
  }, []);

  // 點了推送通知：打開「今天」
  useEffect(() => {
    if (!session || !lastTap || lastTap.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    router.navigate("/");
  }, [lastTap, session]);

  // 鑰匙圈、偏好都讀好了才畫畫面（2.4 起用系統字，不用等字型）
  const ready = session !== undefined && prefsReady;
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, primary: t.ink, background: t.bg, card: t.bg, text: t.ink, border: t.line } };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {ready ? (
        <ThemeProvider value={navTheme}>
          <StatusBar style={t.dark ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" />
            </Stack.Protected>
            <Stack.Screen name="pair" options={{ gestureEnabled: false }} />
          </Stack>
        </ThemeProvider>
      ) : null}
      {/* 蓋在最上面：標誌變成小球，滑到今天頁的位置 */}
      {intro && prefsReady ? <Launch toToday={!!session} onDone={() => setIntro(false)} /> : null}
    </View>
  );
}
