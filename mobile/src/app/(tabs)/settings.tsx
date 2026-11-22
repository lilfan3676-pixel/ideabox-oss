// 設定（從每一頁右上角的圖示進來，不在導覽列裡）：小球（要不要顯示、大小）、語言、這支手機的通知與配對。
// 2.4 起 App 固定深色，沒有外觀選項。
import * as Application from "expo-application";
import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Image, Linking, View } from "react-native";
import { Icon } from "@/components/Icon";
import { LOGO_INV } from "@/components/TabBar";
import { Big, Card, Line, Page, RoundButton, Sec, Segment, Tag, Txt } from "@/components/ui";
import { unpair } from "@/lib/api";
import { L } from "@/lib/i18n";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { disablePush, pushStatus, registerPush } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { clearApiCache } from "@/lib/useApi";

export default function Settings() {
  const t = useTheme();
  const prefs = usePrefs();
  const session = useSession();
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => void pushStatus().then(setPerm), []));

  const enable = async () => {
    setBusy(true);
    const r = await registerPush(true);
    setPerm(await pushStatus());
    setNote(r.ok ? L("推送已開啟，ideabox 有提醒就會通知這支手機。", "Push is on. This phone gets ideabox reminders.") : r.message);
    setBusy(false);
  };
  const pause = async () => {
    setBusy(true);
    await disablePush().catch(() => null);
    setNote(L("已停止推送到這支手機（Telegram 照常會收到）。要恢復再按一次「通知」。", "Push to this phone is paused (Telegram still works). Tap Notifications again to resume."));
    setBusy(false);
  };
  const onPush = () => {
    if (busy) return;
    if (perm === "denied") Linking.openSettings();
    else if (perm === "granted")
      Alert.alert(L("通知", "Notifications"), L("這支手機現在會收到推送。", "This phone receives push now."), [
        { text: L("取消", "Cancel"), style: "cancel" },
        { text: L("重新註冊", "Register again"), onPress: enable },
        { text: L("暫停推送", "Pause push"), style: "destructive", onPress: pause },
      ]);
    else enable();
  };

  const confirmUnpair = () =>
    Alert.alert(L("解除配對？", "Unpair?"), L("這支手機會登出 ideabox，也不會再收到推送。之後要用得在網頁設定頁重新配對。", "This phone signs out of ideabox and stops getting push. Pair again from web settings to come back."), [
      { text: L("取消", "Cancel"), style: "cancel" },
      {
        text: L("解除配對", "Unpair"),
        style: "destructive",
        onPress: async () => {
          clearApiCache();
          await unpair();
        },
      },
    ]);

  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "?";
  const host = session?.server.replace(/^https?:\/\//, "") ?? "—";
  const pushText = perm === "granted" ? L("已開啟", "On") : perm === "denied" ? L("被關掉了", "Blocked") : perm ? L("還沒開", "Off") : "";

  return (
    <Page>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <RoundButton icon="back" label={L("返回", "Back")} onPress={() => (router.canGoBack() ? router.back() : router.navigate("/"))} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Image source={LOGO_INV} style={{ width: 16, height: 16 }} accessible={false} />
          <Txt size={13.5} lh={19} muted tab>{`ideabox ${version}`}</Txt>
        </View>
      </View>
      <View style={{ marginTop: 16 }}><Big>{L("設定", "Settings")}</Big></View>

      <Sec>{L("小球", "Assistant")}</Sec>
      <Card style={{ paddingVertical: 4 }}>
        <Line first onPress={() => setPrefs({ orb: !prefs.orb })} label={L(`在畫面上顯示小球，${prefs.orb ? "開" : "關"}`, `Show the assistant, ${prefs.orb ? "on" : "off"}`)}>
          <Txt style={{ flex: 1 }}>{L("在畫面上顯示小球", "Show the assistant")}</Txt>
          <Tag tone={prefs.orb ? "main" : undefined}>{prefs.orb ? L("開", "On") : L("關", "Off")}</Tag>
        </Line>
      </Card>
      {prefs.orb ? <Segment value={prefs.orbSize} onPick={(orbSize) => setPrefs({ orbSize })} options={[["s", L("小", "Small")], ["m", L("中", "Medium")], ["l", L("大", "Large")]]} /> : null}

      <Sec>{L("語言", "Language")}</Sec>
      <Segment value={prefs.lang} onPick={(lang) => setPrefs({ lang })} options={[["system", L("跟手機", "System")], ["zh", "中文"], ["en", "English"]]} />

      <Sec>{L("這支手機", "This phone")}</Sec>
      <Card style={{ paddingVertical: 4 }}>
        <Line first onPress={onPush} label={`${L("通知", "Notifications")}，${pushText}`}>
          <Icon name="bell" size={18} color={t.muted} />
          <Txt style={{ flex: 1 }}>{L("通知", "Notifications")}</Txt>
          <Txt size={13.5} lh={19} color={perm === "denied" ? t.badText : t.muted}>{busy ? L("處理中", "Working") : pushText}</Txt>
        </Line>
        <Line>
          <Icon name="link" size={18} color={t.muted} />
          <Txt>{L("連到", "Connected to")}</Txt>
          <Txt size={12.5} lh={18} muted numberOfLines={1} style={{ flex: 1, textAlign: "right" }}>{host}</Txt>
        </Line>
        <Line onPress={confirmUnpair}>
          <Icon name="unlink" size={18} color={t.badText} />
          <Txt color={t.badText}>{L("解除配對", "Unpair")}</Txt>
        </Line>
      </Card>
      <Txt size={12.5} lh={20} muted style={{ marginTop: 14 }}>
        {note ?? L("有時間的排程開始前 30 分鐘、早上 8 點的今日排程、產品掛掉或恢復時會通知你。App 只能看，要改資料請到網頁或用 Telegram。", "You get a push 30 minutes before timed events, at 8:00 for today's schedule, and when a product goes down or recovers. The app is read-only. Edit on the web or by Telegram.")}
      </Txt>
    </Page>
  );
}
