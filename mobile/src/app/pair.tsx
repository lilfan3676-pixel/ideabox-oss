import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Backdrop } from "@/components/ui";
import { useStyles, useTheme, type Palette } from "@/lib/theme";
import { ApiError, pair } from "@/lib/api";
import { cleanServer } from "@/lib/session";

const LOGO = require("../../assets/logo-444.png");
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
      setError(e instanceof ApiError ? e.message : "配對失敗，請再試一次。");
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
      setError("沒有相機權限，可以改用「手動輸入」。");
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
          <Text style={st.scanText}>對準 ideabox 設定頁上的 QR code</Text>
        </View>
        <View style={st.frame} pointerEvents="none" />
        <View style={[st.scanBottom, { paddingBottom: insets.bottom + 20 }]}>
          {busy ? <ActivityIndicator color="white" /> : null}
          <Pressable onPress={() => setMode("home")} style={st.scanCancel}>
            <Text style={{ color: "white", fontSize: 17, fontWeight: "600" }}>取消</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bgA }}>
      <Backdrop />
      <ScrollView
        contentContainerStyle={[st.wrap, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="never"
      >
        {/* 標誌後面一圈冷光（跟今天頁晚上的月亮一樣） */}
        <View style={{ alignItems: "center", marginTop: mode === "home" ? 60 : 0 }}>
          {mode === "home" ? (
            <View style={{ width: 300, height: 300, alignItems: "center", justifyContent: "center", experimental_backgroundImage: "radial-gradient(circle, rgba(120,140,190,0.34) 0%, rgba(120,140,190,0) 68%)" }}>
              <Image source={LOGO} accessibilityLabel="ideabox 標誌" style={{ width: 148, height: 148, borderRadius: 74, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" }} />
            </View>
          ) : null}
          <Text accessibilityRole="header" style={st.logo}>連上你的 ideabox</Text>
          <Text style={st.lead}>在電腦打開 ideabox 網頁的「設定 → 手機 App」，掃上面的 QR code。</Text>
        </View>

        {error ? <Text style={[st.error, { textAlign: "center" }]}>{error}</Text> : null}

        {mode === "home" ? (
          <View style={{ gap: 12, marginTop: 28, flexGrow: 1, justifyContent: "flex-end" }}>
            <Pressable style={st.primary} onPress={startScan} disabled={busy}>
              {busy ? <ActivityIndicator color={t.inkText} /> : <Text style={st.primaryText}>掃 QR code 配對</Text>}
            </Pressable>
            <Pressable style={st.secondary} onPress={() => { setError(null); setMode("manual"); }} disabled={busy}>
              <Text style={st.secondaryText}>手動輸入配對碼</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 28 }}>
            <Text style={st.label}>ideabox 網址</Text>
            <TextInput style={st.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL" placeholder={DEFAULT_SERVER || "https://my-ideabox.vercel.app"} placeholderTextColor={t.faint} />
            <Text style={st.label}>配對碼（網頁上顯示的 8 個字）</Text>
            <TextInput
              style={[st.input, st.code]}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD-EFGH"
              placeholderTextColor={t.faint}
              maxLength={12}
              returnKeyType="go"
              onSubmitEditing={() => submit(server, code)}
              autoFocus
            />
            <Pressable style={[st.primary, { marginTop: 8 }, (!code.trim() || busy) && { opacity: 0.5 }]} disabled={!code.trim() || busy} onPress={() => submit(server, code)}>
              {busy ? <ActivityIndicator color={t.inkText} /> : <Text style={st.primaryText}>配對</Text>}
            </Pressable>
            <Pressable style={st.secondary} onPress={() => setMode("home")} disabled={busy}>
              <Text style={st.secondaryText}>返回</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const make = (t: Palette) => StyleSheet.create({
  wrap: { paddingHorizontal: 24, flexGrow: 1 },
  logo: { fontSize: 27, fontWeight: "700", color: t.text, textAlign: "center", marginTop: 8 },
  lead: { fontSize: 15, lineHeight: 24, color: t.muted, marginTop: 10, textAlign: "center", paddingHorizontal: 12 },
  error: { fontSize: 15, lineHeight: 21, color: t.danger, marginTop: 18 },
  primary: { height: 56, borderRadius: 28, backgroundColor: t.ink, alignItems: "center", justifyContent: "center", boxShadow: t.name === "portal" ? t.shadow : undefined },
  primaryText: { color: t.inkText, fontSize: 17, fontWeight: "700" },
  secondary: { height: 52, borderRadius: 26, backgroundColor: "#0c0c0d", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: t.text, fontSize: 17, fontWeight: "700" },
  label: { fontSize: 13, color: t.muted, marginTop: 6, marginLeft: 4 },
  input: { height: 50, borderRadius: t.name === "portal" ? 0 : 12, borderWidth: t.borderWidth, borderColor: t.border, backgroundColor: t.field, paddingHorizontal: 14, fontSize: 17, color: t.text },
  code: { fontSize: 22, letterSpacing: 4, fontVariant: ["tabular-nums"], fontWeight: "600" },
  scanTop: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", paddingBottom: 14, backgroundColor: "rgba(0,0,0,0.45)" },
  scanText: { color: "white", fontSize: 17, fontWeight: "600" },
  frame: { position: "absolute", alignSelf: "center", top: "30%", width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: "rgba(255,255,255,0.85)" },
  scanBottom: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center", gap: 16 },
  scanCancel: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.2)" },
});
