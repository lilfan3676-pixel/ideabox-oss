import * as Application from "expo-application";
import Constants from "expo-constants";
import { router } from "expo-router";
import { setThemePref, THEME_LABEL, THEME_SWATCH, useTheme, useThemeState, type Palette } from "@/lib/theme";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Hero } from "@/components/blocks";
import { Row, Screen, Section } from "@/components/ui";
import { saveAssistantPos, useAssistantPos } from "@/lib/assistantPos";
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

  const { pref, web } = useThemeState();
  const assistant = useAssistantPos();
  const version = `${Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "?"}（編譯 ${Application.nativeBuildVersion ?? "開發版"}）`;
  const host = session?.server.replace(/^https?:\/\//, "") ?? "—";
  const pushOn = perm === "granted";

  return (
    <Screen>
      {/* 主角：連線與推送狀態；推送沒開就是橘色卡，直接給按鈕 */}
      {pushOn ? (
        <Hero kicker="已連線" title={host} sub={`推送已開啟・版本 ${version}`} tone="soft" color={t.ok} />
      ) : (
        <Hero kicker="已連線・推送還沒開" title={host} sub={perm === "denied" ? "通知被關掉了，要到 iPhone 設定打開才收得到提醒。" : "打開推送，排程、里程碑和產品掛掉時才會通知你。"} color={t.warn}>
          <Pressable
            onPress={perm === "denied" ? () => Linking.openSettings() : busy ? undefined : enable}
            accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 14, alignSelf: "flex-start", backgroundColor: "#ffffff", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, opacity: pressed || busy ? 0.8 : 1 })}
          >
            <Text style={{ fontSize: 15, fontWeight: "800", color: t.warn }}>{perm === "denied" ? "到 iPhone 設定打開" : busy ? "處理中…" : "開啟推送"}</Text>
          </Pressable>
        </Hero>
      )}
      <Section title="外觀" footer={`網頁目前是 ${THEME_LABEL[web.theme]}・${web.mode === "dark" ? "深色" : "淺色"}${web.theme === "portal" ? "（App 沒有 Portal，跟網頁時用 Ember）" : ""}。選「跟網頁」的話，網頁換主題後 App 下次更新資料就會跟著換。`}>
        <View style={{ padding: 14, gap: 14 }}>
          <Choice
            t={t}
            label="主題"
            value={pref.theme === "portal" ? "ember" : pref.theme}
            options={[
              ["web", "跟網頁"],
              ["fluento", THEME_LABEL.fluento, THEME_SWATCH.fluento],
              ["ember", THEME_LABEL.ember, THEME_SWATCH.ember],
            ]}
            onPick={(v) => setThemePref({ theme: v as typeof pref.theme })}
          />
          <Choice
            t={t}
            label="淺色／深色"
            value={pref.mode}
            options={[
              ["web", "跟網頁"],
              ["system", "跟 iPhone"],
              ["light", "淺色"],
              ["dark", "深色"],
            ]}
            onPick={(v) => setThemePref({ mode: v as typeof pref.mode })}
          />
        </View>
      </Section>


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

      <Section title="小助手" footer="把小助手拖到想放的地方就會停在那裡；拖到螢幕左右邊緣會收起來，只露半個頭，點一下就跳出來。">
        <Row
          title={assistant?.edge ? "目前收在邊邊" : assistant ? "目前在你拖過去的位置" : "目前在右下角"}
          subtitle={assistant ? "點一下回到右下角" : undefined}
          onPress={assistant ? () => saveAssistantPos(null) : undefined}
          last
        />
      </Section>

      <Section footer={`App 只能看、不能改；要改資料請到網頁或用 Telegram。\n版本 ${version}`}>
        <Row title="解除配對" onPress={confirmUnpair} destructive last />
      </Section>
    </Screen>
  );
}

/** 一排可以選的膠囊按鈕（跟網頁的主題切換器一樣） */
function Choice({ t, label, value, options, onPick }: { t: Palette; label: string; value: string; options: [string, string, [string, string]?][]; onPick: (v: string) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: t.muted }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map(([v, text, swatch]) => {
          const on = v === value;
          return (
            <Pressable
              key={v}
              onPress={() => onPick(v)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: t.radiusSm,
                borderWidth: t.borderWidth,
                borderColor: on ? t.ink : t.border,
                backgroundColor: on ? t.ink : t.field,
              }}
            >
              {swatch ? <View style={{ width: 12, height: 12, borderRadius: t.name === "portal" ? 0 : 6, experimental_backgroundImage: `linear-gradient(135deg, ${swatch[0]}, ${swatch[1]})` }} /> : null}
              <Text style={{ fontSize: 15, fontWeight: "600", color: on ? t.inkText : t.text }}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
