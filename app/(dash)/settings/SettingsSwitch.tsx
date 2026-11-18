"use client";

import { useL } from "@/app/LangProvider";
import type { Translate } from "@/lib/i18n";
import { useView } from "../Nav";

const sections = (L: Translate): Record<string, { title: string; desc: string }> => ({
  desc: { title: L("專案描述", "Project descriptions"), desc: L("AI 會依這些描述判斷點子跟哪個專案相關；「關於你」用來找適合的補助", "AI uses these to judge which project an idea fits; “About you” is used to find grants that fit") },
  status: { title: L("連線狀態", "Connections"), desc: L("登入帳號、Telegram Bot 與外部服務的連線情況", "Login account, Telegram Bot and external service status") },
  theme: { title: L("外觀", "Appearance"), desc: L("主題色與淺色／深色", "Accent color and light / dark mode") },
  digest: { title: L("週報", "Weekly digest"), desc: L("每週日晚上的點子精選與補助提醒", "Sunday-night idea picks and grant reminders") },
  learn: { title: L("AI 學習", "AI learning"), desc: L("AI 從你的採用、刪除、備註與補助標記學到的偏好", "Preferences the AI learned from what you adopt, delete, note and mark") },
  app: { title: L("手機 App", "Phone app"), desc: L("配對 ideabox App，在手機上看排程、專案並收推送通知", "Pair the ideabox app to see schedules and projects and get push notifications") },
  partners: { title: L("合夥人", "Partners"), desc: L("讓共同創辦人等合夥人登入網頁與 App，你決定他看得到哪些畫面和專案", "Let co-founders sign in to the web and app; you decide which screens and projects they see") },
});
const KEYS = ["desc", "status", "theme", "digest", "learn", "app", "partners"];

/** 各區塊都已在伺服器準備好，左側圖示列切換時直接顯示，不用重新載入 */
export function SettingsSwitch({ panels, msg }: { panels: Record<string, React.ReactNode>; msg?: string }) {
  const view = useView("desc", KEYS);
  const L = useL();
  const section = sections(L)[view];
  return (
    <>
      {/* 電腦版：一行說明現在是哪一區；手機版照舊 */}
      <div className="view-line d-only">
        <h2>{section.title}</h2>
        <span className="muted small">{section.desc}</span>
      </div>
      <div className="page-title m-only">
        <h1>{L("設定", "Settings")}</h1>
        <p className="muted">{section.title}・{section.desc}</p>
      </div>
      {msg && <p className="notice glass">{msg}</p>}
      <div className={`settings-single settings-v-${view} stagger`} key={view}>
        {panels[view]}
      </div>
    </>
  );
}
