// 把首頁資料推給桌面小工具（iOS）。App 每次讀到首頁就推一次；推失敗不影響 App。
// 小工具的畫面在 src/widgets/，要顯示什麼在 lib/widgetData.ts（純函式）。
import { Platform } from "react-native";
import { projectColor } from "@/components/ui";
import { L, lang } from "./i18n";
import type { HomeData } from "./types";
import { changePoints, projectsData, widgetsAt, type WidgetText } from "./widgetData";

const texts = (): WidgetText => ({
  lang: lang() === "en" ? "en" : "zh",
  next: L("下一件", "Next"),
  nextNone: L("今天沒有排程", "Nothing planned today"),
  allDone: L("今天的事都過了", "All done for today"),
  today: L("今天", "Today"),
  todayEmpty: L("今天沒有排程", "Nothing planned today"),
  projects: L("各專案的下一步", "Next steps"),
  projectsEmpty: L("還沒有進行中的專案", "No active projects"),
  allDay: L("整天", "All day"),
  noStep: L("還沒寫下一步", "No next step"),
  overdue: (n) => L(`${n} 件待辦過期`, `${n} overdue`),
  until: (m) => (m <= 0 ? L("進行中", "now") : m < 60 ? L(`還有 ${m} 分鐘`, `in ${m} min`) : L(`還有 ${Math.round(m / 60)} 小時`, `in ${Math.round(m / 60)} h`)),
});

/** 台北時間現在是當天的第幾分鐘 */
const taipeiMin = (now: number) => Math.floor((((now + 8 * 3_600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000);

export function pushWidgets(home: HomeData, now = Date.now()) {
  if (Platform.OS !== "ios") return;
  try {
    // 用到才載入：模擬器的舊測試版殼或沒有小工具的版本載入會丟錯，接住就好
    const Next = require("@/widgets/NextWidget").default;
    const Today = require("@/widgets/TodayWidget").default;
    const Projects = require("@/widgets/ProjectsWidget").default;
    const T = texts();
    const nowMin = taipeiMin(now);
    const base = now - (now % 60_000);
    const pts = changePoints(home, nowMin);
    const at = (m: number) => new Date(base + (m - nowMin) * 60_000);
    Next.updateTimeline(pts.map((m) => ({ date: at(m), props: widgetsAt(home, m, T).next })));
    Today.updateTimeline(pts.map((m) => ({ date: at(m), props: widgetsAt(home, m, T).today })));
    Projects.updateSnapshot(projectsData(home, projectColor, T));
  } catch {
    // 小工具推不過去不影響 App
  }
}
