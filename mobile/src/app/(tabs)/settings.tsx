// 設定：獨立一頁（從選單進來）。語言、外觀、這支手機的通知與配對
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Image, Linking, Pressable, View } from "react-native";
import { Icon } from "@/components/Icon";
import { LOGO, LOGO_INV } from "@/components/Menu";
import { Orb } from "@/components/Orb";
import { Big, Head, Label, Line, Page, Small, Txt } from "@/components/ui";
import { unpair } from "@/lib/api";
import { L } from "@/lib/i18n";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { disablePush, pushStatus, registerPush } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { clearApiCache } from "@/lib/useApi";

/** 幾個選項排一排，選到的那個是黑字加底線 */
function Choice<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 24 }} accessibilityRole="radiogroup">
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={v} onPress={() => onPick(v)} accessibilityRole="radio" accessibilityState={{ selected: on }} hitSlop={{ top: 4, bottom: 4, left: 10, right: 10 }} style={{ height: 44, justifyContent: "center", borderBottomWidth: 1.5, borderBottomColor: on ? t.ink : "transparent" }}>
            <Txt size={20} lh={28} color={on ? t.ink : t.muted}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

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
      <Head title={L("設定", "Settings")} right={<><Image source={t.dark ? LOGO_INV : LOGO} style={{ width: 18, height: 18 }} accessible={false} /><Txt size={14} lh={20} muted tab>{`ideabox ${version}`}</Txt></>} />
      <View style={{ marginTop: 40 }}><Big lines={1}>{L("設定", "Settings")}</Big></View>

      <Label icon="globe" top={32}>{L("語言", "Language")}</Label>
      <Choice value={prefs.lang} onPick={(lang) => setPrefs({ lang })} options={[["system", L("跟手機", "System")], ["zh", "中文"], ["en", "English"]]} />

      <Label icon="contrast" top={28}>{L("外觀", "Appearance")}</Label>
      <Choice value={prefs.look} onPick={(look) => setPrefs({ look })} options={[["system", L("跟手機", "System")], ["light", L("淺色", "Light")], ["dark", L("深色", "Dark")]]} />

      <Label icon="phone" top={28}>{L("這支手機", "This phone")}</Label>
      <Line onPress={onPush} label={`${L("通知", "Notifications")}，${pushText}`}>
        <Icon name="bell" size={18} color={t.muted} />
        <Txt style={{ flex: 1 }}>{L("通知", "Notifications")}</Txt>
        <Small color={perm === "denied" ? t.badText : undefined}>{busy ? L("處理中", "Working") : pushText}</Small>
      </Line>
      <Line>
        <Icon name="link" size={18} color={t.muted} />
        <Txt>{L("連到", "Connected to")}</Txt>
        <View style={{ flex: 1, alignItems: "flex-end" }}><Small>{host}</Small></View>
      </Line>
      <Line last onPress={confirmUnpair}>
        <Icon name="unlink" size={18} color={t.badText} />
        <Txt color={t.badText}>{L("解除配對", "Unpair")}</Txt>
      </Line>
      <Txt size={13} lh={19} muted style={{ marginTop: 12, marginRight: 96 }}>
        {note ?? L("有時間的排程開始前 30 分鐘、早上 8 點的今日排程、產品掛掉或恢復時會通知你。App 只能看，要改資料請到網頁或用 Telegram。", "You get a push 30 minutes before timed events, at 8:00 for today's schedule, and when a product goes down or recovers. The app is read-only. Edit on the web or by Telegram.")}
      </Txt>
      <View style={{ alignItems: "flex-end", marginRight: -80, marginTop: 8 }}><Orb size={176} /></View>
    </Page>
  );
}
