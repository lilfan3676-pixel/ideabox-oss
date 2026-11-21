import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/Icon";
import { LOGO, LOGO_INV } from "@/components/Menu";
import { Big, ErrorNote, Txt } from "@/components/ui";
import { L } from "@/lib/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONT, useStyles, useTheme, type Palette } from "@/lib/theme";
import { ApiError, pair } from "@/lib/api";
import { cleanServer } from "@/lib/session";

const DEFAULT_SERVER = "";

type Mode = "home" | "scan" | "manual";

/** 從 QR code（ideabox://pair?server=…&code=…）讀出網址和配對碼 */
function parsePairLink(raw: string): { server: string; code: string } | null {
  try {
    const { hostname, path, queryParams } = Linking.parse(raw);
    if ((hostname ?? path ?? "").replace(/\//g, "") !== "pair") return null;
    const server = typeof queryParams?.server === "string" ? queryParams.server : "";
    const code = typeof queryParams?.code === "string" ? queryParams.code : "";
    return server && code ? { server: cleanServer(server), code } : null;
  } catch {
    return null;
  }
}

export default function Pair() {
  const t = useTheme();
  const st = useStyles(make);
  const insets = useSafeAreaInsets();
  // iPhone 相機直接掃 QR code 時會用 ideabox://pair?server=…&code=… 打開這頁
  const params = useLocalSearchParams<{ server?: string; code?: string }>();
  const [mode, setMode] = useState<Mode>("home");
  const [server, setServer] = useState(params.server ? cleanServer(params.server) : DEFAULT_SERVER);
  const [code, setCode] = useState(params.code ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perm, requestPerm] = useCameraPermissions();
  const scanned = useRef(false);

  const submit = async (srv: string, c: string) => {
    setBusy(true);
    setError(null);
    try {
      await pair(cleanServer(srv), c, Device.deviceName ?? Device.modelName ?? "iPhone");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(e instanceof ApiError ? e.message : L("配對失敗，請再試一次。", "Pairing failed. Try again."));
      scanned.current = false;
      setMode((m) => (m === "scan" ? "home" : m));
    } finally {
      setBusy(false);
    }
  };

  // 從連結打開：直接配對
  useEffect(() => {
    if (params.server && params.code) submit(params.server, params.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.server, params.code]);

  const startScan = async () => {
    setError(null);
    const p = perm?.granted ? perm : await requestPerm();
    if (!p.granted) {
      setError(L("沒有相機權限，可以改用手動輸入。", "No camera access. Enter the code by hand instead."));
      return;
    }
    scanned.current = false;
    setMode("scan");
  };

  if (mode === "scan") {
    return (
      <View style={{ flex: 1, backgroundColor: "black" }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (scanned.current) return;
            const link = parsePairLink(data);
            if (!link) return;
            scanned.current = true;
            submit(link.server, link.code);
          }}
        />
        <View style={[st.scanTop, { paddingTop: insets.top + 12 }]}>
          <Text style={st.scanText}>{L("對準 ideabox 設定頁上的 QR code", "Point at the QR code in ideabox settings")}</Text>
        </View>
        <View style={st.frame} pointerEvents="none" />
        <View style={[st.scanBottom, { paddingBottom: insets.bottom + 20 }]}>
          {busy ? <ActivityIndicator color="white" /> : null}
          <Pressable onPress={() => setMode("home")} style={st.scanCancel}>
            <Text style={{ color: "white", fontSize: 17, fontFamily: FONT }}>{L("取消", "Cancel")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const input = { height: 52, borderRadius: 16, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, paddingHorizontal: 16, fontSize: 17, color: t.ink, fontFamily: FONT } as const;
  const primary = (label: string, icon: "scan" | "key" | "link", onPress: () => void, off?: boolean) => (
    <Pressable onPress={onPress} disabled={off || busy} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 10, height: 52, paddingHorizontal: 24, borderRadius: 26, backgroundColor: t.ink, opacity: off ? 0.4 : pressed ? 0.7 : 1 })}>
      {busy ? <ActivityIndicator color={t.bg} /> : <Icon name={icon} size={18} color={t.bg} />}
      <Txt color={t.bg}>{label}</Txt>
    </Pressable>
  );
  const secondary = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" hitSlop={8} style={{ alignSelf: "flex-start", height: 44, justifyContent: "center" }}>
      <Txt size={15} style={{ textDecorationLine: "underline" }}>{label}</Txt>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingTop: insets.top + 72, paddingBottom: insets.bottom + 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}>
        {/* 這頁沒有小球：標誌就是它 */}
        <Image source={t.dark ? LOGO_INV : LOGO} accessibilityLabel={L("ideabox 標誌", "ideabox logo")} style={{ width: 72, height: 72 }} />
        <View style={{ marginTop: 48 }}><Big>{L("先跟電腦配對", "Pair with your computer")}</Big></View>
        <Txt muted lh={24} style={{ marginTop: 12, maxWidth: 290 }}>{L("在電腦打開 ideabox 的設定，選「手機 App」，用相機掃畫面上的 QR code", "Open ideabox settings on your computer, choose Mobile app, and scan the QR code on screen")}</Txt>
        {error ? <ErrorNote text={error} /> : null}

        {mode === "home" ? (
          <View style={{ gap: 8, marginTop: 40 }}>
            {primary(L("打開相機", "Open camera"), "scan", startScan)}
            {secondary(L("手動輸入配對碼", "Enter the code by hand"), () => { setError(null); setMode("manual"); })}
          </View>
        ) : (
          <View style={{ gap: 8, marginTop: 32 }}>
            <Txt size={14} muted>{L("ideabox 網址", "ideabox address")}</Txt>
            <TextInput style={input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" placeholder={DEFAULT_SERVER} placeholderTextColor={t.muted} />
            <Txt size={14} muted style={{ marginTop: 8 }}>{L("配對碼（網頁上顯示的 8 個字）", "Pairing code (8 characters shown on the web)")}</Txt>
            <TextInput style={[input, { fontSize: 22, letterSpacing: 4, fontVariant: ["tabular-nums"] }]} value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} placeholder="ABCD-EFGH" placeholderTextColor={t.muted} maxLength={12} returnKeyType="go" onSubmitEditing={() => submit(server, code)} autoFocus />
            <View style={{ marginTop: 16, gap: 8 }}>
              {primary(L("配對", "Pair"), "key", () => submit(server, code), !code.trim())}
              {secondary(L("返回", "Back"), () => setMode("home"))}
            </View>
          </View>
        )}
        <View style={{ flex: 1, minHeight: 24 }} />
        <Txt size={13} muted>{L("只有你自己的手機能配對", "Only your own phone can pair")}</Txt>
      </ScrollView>
    </View>
  );
}

const make = (_t: Palette) => StyleSheet.create({
  scanTop: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 14, backgroundColor: "rgba(0,0,0,0.45)" },
  scanText: { color: "white", fontSize: 17, fontFamily: FONT },
  frame: { position: "absolute", alignSelf: "center", top: "30%", width: 240, height: 240, borderRadius: 24, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  scanBottom: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 16 },
  scanCancel: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.2)" },
});
