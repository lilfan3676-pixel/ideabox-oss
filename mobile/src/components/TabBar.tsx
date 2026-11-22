// 底部懸浮的導覽列：五個圖示（今天、月曆、專案、監控、辦公室），沒有字；目前那一頁是主色的實心圓。
// 設定不在這裡，在每一頁右上角的圖示（使用者 2026-11-22 要的）。合夥人的手機只會看到他有權限的畫面。
import * as Haptics from "expo-haptics";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { L } from "@/lib/i18n";
import { glide } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { HomeData, OfficeData } from "@/lib/types";
import { peekApi } from "@/lib/useApi";
import { Icon, type IconName } from "./Icon";

export const LOGO = require("../../assets/logo-ball.png");
export const LOGO_INV = require("../../assets/logo-ball-inv.png");

export const PAGES: { key: string; path: string; icon: IconName }[] = [
  { key: "today", path: "/", icon: "sun" },
  { key: "calendar", path: "/calendar", icon: "calendar" },
  { key: "projects", path: "/projects", icon: "folder" },
  { key: "monitor", path: "/monitor", icon: "activity" },
  { key: "office", path: "/office", icon: "users" },
];
export const pageName = (key: string) =>
  ({ today: L("今天", "Today"), calendar: L("月曆", "Calendar"), projects: L("專案", "Projects"), monitor: L("監控", "Monitor"), office: L("辦公室", "Office"), settings: L("設定", "Settings") })[key] ?? key;
export const pageOf = (pathname: string) => PAGES.find((p) => p.path !== "/" && pathname.startsWith(p.path)) ?? PAGES[0];
/** 導覽列離螢幕底多遠 */
export const dockBottom = (insetBottom: number) => Math.max(insetBottom, 12) + 6;
/** 導覽列的高度（小球、頁面留白要避開它） */
export const DOCK_H = 62;
const STEP = 56;

export function TabBar() {
  const t = useTheme();
  usePrefs();
  const insets = useSafeAreaInsets();
  const current = pageOf(usePathname());
  const tabs = useSession()?.tabs;
  const items = PAGES.filter((p) => p.key === "today" || !tabs || tabs.includes(p.key));
  // 辦公室有人在等你：圖示右上角一個重點色的點（只看已經讀到的資料，不另外連線）
  // 辦公室那一頁一分鐘內讀過就用它的，不然用首頁帶回來的人數（離開辦公室後它的資料就不會再更新）
  const office = peekApi<OfficeData>("/api/app/office");
  const fresh = office && Date.now() - office.now < 60_000;
  const waiting = fresh ? office.people.some((p) => p.status === "waiting" || p.status === "permission") : (peekApi<HomeData>("/api/app/home")?.office_waiting ?? 0) > 0;
  // 主色的圓是獨立一層，換頁時滑到新的位置（每格 50 寬、間距 6）
  const at = Math.max(0, items.findIndex((p) => p.key === current.key));
  const x = useRef(new Animated.Value(at * STEP)).current;
  useEffect(() => glide(x, at * STEP), [x, at]);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: dockBottom(insets.bottom), alignItems: "center" }}>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", alignItems: "center", gap: 6, height: DOCK_H, paddingHorizontal: 8, borderRadius: DOCK_H / 2, backgroundColor: t.solid, boxShadow: "0px 10px 30px rgba(0,0,0,0.5)" }}>
        <Animated.View pointerEvents="none" style={{ position: "absolute", left: 8, top: (DOCK_H - 46) / 2, width: 50, height: 46, borderRadius: 23, backgroundColor: t.main, transform: [{ translateX: x }] }} />
        {items.map((p) => {
          const on = p.key === current.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => {
                if (on) return;
                Haptics.selectionAsync().catch(() => null);
                // 圓點先開始滑（原生動畫，不會被新頁面的載入卡住）
                glide(x, items.indexOf(p) * STEP);
                router.navigate(p.path as never);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={pageName(p.key)}
              hitSlop={4}
              style={({ pressed }) => ({ width: 50, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name={p.icon} size={21} color={on ? t.onMain : t.muted} />
              {p.key === "office" && waiting && !on ? <View style={{ position: "absolute", top: 9, right: 11, width: 8, height: 8, borderRadius: 4, backgroundColor: t.acc, borderWidth: 1.5, borderColor: t.solid }} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
