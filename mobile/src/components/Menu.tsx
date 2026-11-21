// 選單：整頁的大字清單，一列一個功能＝圖示＋名稱＋它現在的狀況，不用點進去就知道哪裡有事。
// 目前所在的那個是黑字加兩條小眼睛；合夥人的手機只會看到他有權限的畫面
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { addDays, md, pastBy, taipeiHm } from "@/lib/format";
import { L } from "@/lib/i18n";
import { reduceMotion } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { HomeData } from "@/lib/types";
import { peekApi } from "@/lib/useApi";
import { Icon, type IconName } from "./Icon";
import { Orb } from "./Orb";
import { Big, RoundButton, Sig, Txt } from "./ui";

export const LOGO = require("../../assets/logo-ball.png");
export const LOGO_INV = require("../../assets/logo-ball-inv.png");

export const PAGES: { key: string; path: string; icon: IconName }[] = [
  { key: "today", path: "/", icon: "sun" },
  { key: "calendar", path: "/calendar", icon: "calendar" },
  { key: "projects", path: "/projects", icon: "folder" },
  { key: "monitor", path: "/monitor", icon: "activity" },
  { key: "office", path: "/office", icon: "users" },
  { key: "settings", path: "/settings", icon: "sliders" },
];
export const pageName = (key: string) =>
  ({ today: L("今天", "Today"), calendar: L("月曆", "Calendar"), projects: L("專案", "Projects"), monitor: L("監控", "Monitor"), office: L("辦公室", "Office"), settings: L("設定", "Settings") })[key] ?? key;
export const pageOf = (pathname: string) => PAGES.find((p) => p.path !== "/" && pathname.startsWith(p.path)) ?? PAGES[0];
export const dockBottom = (insetBottom: number) => Math.max(insetBottom, 12) + 8;

/** 每個功能現在的狀況（從首頁已經讀到的資料算，不另外連線） */
function statusOf(key: string, home: HomeData | null, prefs: { lang: string; look: string }): { text: string; bad?: boolean } {
  if (key === "settings") {
    const look = prefs.look === "system" ? L("跟手機", "System") : prefs.look === "dark" ? L("深色", "Dark") : L("淺色", "Light");
    return { text: `${L("中文", "English")}，${look}` };
  }
  if (!home) return { text: "" };
  const today = home.today;
  if (key === "today") {
    const hm = taipeiHm();
    const mine = home.events.filter((e) => e.start_date <= today && e.end_date >= today);
    const next = mine.filter((e) => e.start_time && !pastBy(e.start_time, hm)).sort((a, b) => a.start_time!.localeCompare(b.start_time!))[0];
    return { text: next ? `${next.start_time} ${next.title}` : mine.length ? L(`${mine.length} 件事`, `${mine.length} things`) : L("沒有排程", "Nothing planned") };
  }
  if (key === "calendar") {
    const end = addDays(today, 6);
    const n = home.events.filter((e) => e.start_date <= end && e.end_date >= today).length + home.milestones.filter((m) => !m.done && m.due >= today && m.due <= end).length;
    return { text: n ? L(`這週 ${n} 件`, `${n} this week`) : L("這週沒有", "Clear week") };
  }
  if (key === "projects") {
    const n = home.projects.filter((p) => p.status === "active").length;
    return { text: L(`${n} 個進行中`, `${n} active`) };
  }
  if (key === "monitor") {
    const down = home.monitor.filter((m) => !m.ok);
    if (down.length) return { text: L(`${down[0].label} 連不上`, `${down[0].label} is down`), bad: true };
    return { text: home.monitor.length ? L("都正常", "All good") : "" };
  }
  return { text: "" };
}

export function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const prefs = usePrefs();
  const insets = useSafeAreaInsets();
  const current = pageOf(usePathname());
  const tabs = useSession()?.tabs;
  const home = peekApi<HomeData>("/api/app/home");
  const items = PAGES.filter((p) => p.key === "today" || p.key === "settings" || !tabs || tabs.includes(p.key));

  // 打開：整頁淡入，每一列一個接一個從下面浮上來；關掉：一起淡出
  const [shown, setShown] = useState(open);
  const veil = useRef(new Animated.Value(0)).current;
  const rows = useRef(PAGES.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (open) setShown(true);
    if (reduceMotion()) {
      veil.setValue(open ? 1 : 0);
      rows.forEach((r) => r.setValue(1));
      if (!open) setShown(false);
      return;
    }
    if (open) rows.forEach((r) => r.setValue(0));
    const anim = open
      ? Animated.parallel([
          Animated.timing(veil, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.stagger(34, rows.map((r) => Animated.timing(r, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }))),
        ])
      : Animated.timing(veil, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: true });
    anim.start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
    return () => anim.stop();
  }, [open, veil, rows]);

  const go = (path: string) => () => {
    Haptics.selectionAsync().catch(() => null);
    onClose();
    router.navigate(path as never);
  };

  return (
    <Modal visible={open || shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: t.bg, opacity: veil, paddingTop: insets.top + 12, paddingHorizontal: 28 }} accessibilityViewIsModal>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 }}>
          <Image source={t.dark ? LOGO_INV : LOGO} style={{ width: 24, height: 24 }} accessibilityLabel={L("ideabox 標誌", "ideabox logo")} />
          <Txt size={14} lh={20}>ideabox</Txt>
          <View style={{ flex: 1 }} />
          <Txt size={14} lh={20} muted tab style={{ marginRight: 88 }}>{home ? md(home.today) : ""}</Txt>
        </View>
        <Orb size={120} shadow={false} style={{ position: "absolute", right: -32, top: insets.top - 20 }} />

        <View style={{ marginTop: 64 }} accessibilityRole="menu">
          {items.map((p, i) => {
            const on = p.key === current.key;
            const s = statusOf(p.key, home, prefs);
            const v = rows[i];
            return (
              <Animated.View key={p.key} style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
                <Pressable
                  onPress={go(p.path)}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${pageName(p.key)}${s.text ? `，${s.text}` : ""}`}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, height: 80, borderBottomWidth: i === items.length - 1 ? 0 : 1, borderBottomColor: t.line, opacity: pressed ? 0.5 : 1 })}
                >
                  <Icon name={p.icon} size={22} color={on ? t.ink : t.muted} />
                  <View style={{ minWidth: 104 }}>
                    <Big size={32} lines={1} fit={false}>{pageName(p.key)}</Big>
                  </View>
                  <Txt size={14} lh={20} color={s.bad ? t.badText : t.muted} numberOfLines={1} style={{ flex: 1 }}>{s.text}</Txt>
                  {on ? <Sig label={L("現在在這頁", "You are here")} w={4} h={14} /> : null}
                </Pressable>
              </Animated.View>
            );
          })}
        </View>

        <View style={{ position: "absolute", left: 24, bottom: dockBottom(insets.bottom) }}>
          <RoundButton icon="close" label={L("關閉選單", "Close menu")} onPress={onClose} size={48} />
        </View>
      </Animated.View>
    </Modal>
  );
}
