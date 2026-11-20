import * as Application from "expo-application";
import Constants from "expo-constants";
import { router } from "expo-router";
import { haloAt, useTheme } from "@/lib/theme";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Row, Screen, Section } from "@/components/ui";
import { unpair } from "@/lib/api";
import { disablePush, pushStatus, registerPush } from "@/lib/push";
import { useSession } from "@/lib/session";
import { clearApiCache } from "@/lib/useApi";

export default function Settings() {
  const t = useTheme();
  const session = useSession();
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => void pushStatus().then(setPerm), []));

  const enable = async () => {
    setBusy(true);
    const r = await registerPush(true);
    setPerm(await pushStatus());
    setNote(r.ok ? "推送已開啟，ideabox 有提醒就會通知這支手機。" : r.message);
    setBusy(false);
  };

  const off = async () => {
    setBusy(true);
    await disablePush().catch(() => null);
    setNote("已停止推送到這支手機（Telegram 照常會收到）。要恢復按「開啟推送」。");
    setBusy(false);
  };

  const confirmUnpair = () =>
    Alert.alert("解除配對？", "這支手機會登出 ideabox，也不會再收到推送。之後要用得在網頁設定頁重新配對。", [
      { text: "取消", style: "cancel" },
      {
        text: "解除配對",
        style: "destructive",
        onPress: () => {
          // 先把設定頁收起來，等動畫結束再清掉配對資訊（根路由的保護會自動回到配對畫面）；
          // 彈出頁還開著就換掉底下的畫面，配對頁的版面會算錯
          router.dismissAll();
          setTimeout(async () => {
            clearApiCache();
            await unpair();
          }, 400);

        },
      },
    ]);

  const version = `${Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "?"}（編譯 ${Application.nativeBuildVersion ?? "開發版"}）`;
  const host = session?.server.replace(/^https?:\/\//, "") ?? "—";
  const pushOn = perm === "granted";

  return (
    <Screen>
      <Text style={{ fontSize: 27, fontWeight: "700", color: t.text, marginTop: 30, marginBottom: 6, marginHorizontal: 22 }} accessibilityRole="header">
        設定
      </Text>
      {/* 主角：連線狀態一張光環漸層卡；推送沒開就直接給按鈕 */}
      <View style={{ marginHorizontal: 12, marginTop: 10, minHeight: 176, borderRadius: 24, padding: 16, backgroundColor: "#0f7f86", experimental_backgroundImage: haloAt(pushOn ? 1 : 4, "80% 20%") }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: "#ffffff" }}>已連線</Text>
        <Text style={{ fontSize: 24, fontWeight: "700", color: "#ffffff", marginTop: 4 }} numberOfLines={2}>{host}</Text>
        {pushOn ? null : (
          <>
            <Text style={{ fontSize: 14, color: "#ffffff", marginTop: 8, lineHeight: 20 }}>{perm === "denied" ? "通知被關掉了，要到 iPhone 設定打開才收得到提醒。" : "打開推送，排程、里程碑和產品掛掉時才會通知這支手機。"}</Text>
            <Pressable
              onPress={perm === "denied" ? () => Linking.openSettings() : busy ? undefined : enable}
              accessibilityRole="button"
              style={({ pressed }) => ({ marginTop: 12, alignSelf: "flex-start", backgroundColor: "#ffffff", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, opacity: pressed || busy ? 0.8 : 1 })}
            >
              <Text style={{ fontSize: 15, fontWeight: "800", color: "#111111" }}>{perm === "denied" ? "到 iPhone 設定打開" : busy ? "處理中…" : "開啟推送"}</Text>
            </Pressable>
          </>
        )}
        <View style={{ flex: 1, minHeight: 14 }} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: pushOn ? "#9dffbf" : "#ffe14a" }} />
            <Text style={{ fontSize: 13, color: "#ffffff" }}>{pushOn ? "推送已開啟" : "推送還沒開"}</Text>
          </View>
          <Text style={{ fontSize: 13, color: "#ffffff" }}>版本 {Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "?"}</Text>
        </View>
      </View>

      <Section
        title="推送通知"
        footer={note ?? "有填時間的排程開始前 30 分鐘、早上 8 點的今日排程與里程碑、產品掛掉或恢復時會通知你。"}
      >
        <Row
          title="通知權限"
          right={<Text style={{ fontSize: 17, color: perm === "granted" ? t.ok : t.muted }}>{perm === "granted" ? "已允許" : perm === "denied" ? "已關閉" : perm ? "還沒決定" : "…"}</Text>}
        />
        {perm === "denied" ? (
          <Row title="到 iPhone 設定打開通知" onPress={() => Linking.openSettings()} last />
        ) : (
          <>
            <Row title={busy ? "處理中…" : "開啟推送（重新註冊這支手機）"} onPress={busy ? undefined : enable} last={perm !== "granted"} />
            {perm === "granted" ? <Row title="暫停推送到這支手機" onPress={busy ? undefined : off} last /> : null}
          </>
        )}
      </Section>


      <Section footer={`App 只能看、不能改；要改資料請到網頁或用 Telegram。\n版本 ${version}`}>
        <Row title="解除配對" onPress={confirmUnpair} destructive last />
      </Section>
    </Screen>
  );
}
