// 模組（外掛）介面：核心功能是通用的，個人產品（例如自己的 App 的封測回報、私人工具）
// 寫成模組註冊在 lib/modules/server.ts／client.tsx，核心程式不用知道它們的存在。
// 公開版的這兩個檔案是空清單（server.public.ts／client.public.tsx），私人版列出自己的模組。

import type { Issue, SysEvent } from "../healthLogic";
import type { CheckResult } from "../monitorLogic";
import type { Access } from "../accessLogic";
import type { Project } from "../projectLogic";

/** 監控裡的一個產品（純資料，會傳給瀏覽器畫面） */
export type MonitorProduct = {
  key: string;
  label: string;
  /** 依顯示順序 */
  services: { id: string; zh: string; en: string }[];
  /** 三個數字的名稱（有回報使用者數的產品才有） */
  metrics?: { users: [string, string]; active7: [string, string]; new7: [string, string] };
  /** 資料庫容量上限（位元組），有回報 db_bytes 的才需要 */
  dbLimitBytes?: number;
  dbLabel?: [string, string];
  /** 對應的專案短名（專案詳細頁顯示這個產品的數據） */
  slugs?: string[];
  /** 還沒設定完成時的提示（只檢查一部分） */
  setupHint?: [string, string] | null;
  /** 通用網址監控建立的（可以在畫面上刪除） */
  site?: { id: string; url: string };
};

/** 產品的分組統計（例如使用者的組成），手機 App 監控分頁在產品卡片裡顯示；只給主人看 */
export type ProductBreakdown = {
  product: string;
  title: string;
  note?: string;
  /** 讀不到時的說明（有這個就不畫圖） */
  error?: string;
  /** 可切換的幾種算法，例如「已完成註冊／全部」 */
  views: {
    label: string;
    total: number;
    /** 比例條，color 是 #rrggbb */
    parts: { label: string; n: number; pct: number; color: string }[];
    table?: { cols: string[]; rows: { label: string; cells: number[] }[] };
  }[];
};

export type MonitorStats = { users: number; active7: number; new7: number; db_bytes: number };
export type MonitorOutcome = { service: string; product: string; result: CheckResult; stats?: MonitorStats };

/** Telegram 的另一個存放地點（點子庫以外），例如私人的地點清單 */
export type TgDestination = {
  key: string;
  /** 按鈕與訊息上的名字，例如「地點清單」 */
  label: string;
  /** 名字前面的小圖示，例如「🍵」 */
  icon?: string;
  /** 開頭打這些字就強制存到這裡（不分大小寫），例如 ["地點", "place"] */
  prefixes: string[];
  /** 這則訊息有多像要存到這裡：0 = 不像；跟點子相關字的分數比較 */
  score: (all: string, urls: string[]) => number;
  /** 讀連結內容幫忙判斷（選填） */
  readLink?: (url: string) => Promise<string | null>;
  /** 存進去，回傳要給 Telegram 的訊息與「改存到點子庫」時要刪掉的資料 */
  save: (body: string) => Promise<{ text: string; undo?: unknown }>;
  /** 改存到點子庫前，刪掉剛剛存的資料 */
  undo?: (undo: unknown) => Promise<void>;
};

/** 模組加在專案詳細頁的分頁：key 是網址上的 ?tab=，render 只有切到這個分頁時才會呼叫 */
/** href＝這個分頁其實在別的頁面，點了直接過去（舊網址 ?tab=<key> 也會轉過去）；沒有 href 的要給 render */
/** tool＝這個專案自己的工具頁（href 那一頁上面會有同一排專案分頁，所以不標「↗」） */
export type ProjectTab = { key: string; label: [string, string]; count?: number; href?: string; tool?: boolean; render?: () => Promise<React.ReactNode> };

export type BellDef = {
  key: string;
  label: [string, string];
  hint: [string, string];
  href: string;
  tone: "danger" | "warn";
  count: () => Promise<number>;
};

export type ServerModule = {
  key: string;
  /** 每日排程（台北 21:00）要做的事；丟出錯誤會記成這個模組的錯誤 */
  daily?: (ctx: { isSunday: boolean }) => Promise<unknown>;
  /** 每天早上 8 點的專案總覽：多放幾行（Telegram HTML）；要另外提醒的事模組自己傳 */
  morning?: (ctx: { now: number; today: string }) => Promise<string[]>;
  /** 產品監控（每 5 分鐘） */
  monitor?: { products: () => MonitorProduct[]; run: () => Promise<MonitorOutcome[]> };
  /** 手機 App 監控分頁的產品分組統計（只給主人） */
  breakdowns?: () => Promise<ProductBreakdown[]>;
  /** 每週健康檢查多檢查的項目 */
  health?: (ctx: { events: SysEvent[]; now: number; since: number }) => Promise<Issue[]>;
  /** 右上角鈴鐺的待處理項目 */
  bell?: BellDef[];
  /** Telegram 的其他存放地點 */
  telegram?: TgDestination;
  /** 專案詳細頁：這個專案的回報時間（最近 12 週，畫每週數量） */
  projectFeedback?: (slug: string, sinceIso: string) => Promise<string[] | null>;
  /** 專案詳細頁多出的分頁（例如某個專案專用的名單）；回傳這個專案要顯示的分頁，沒有就回空陣列 */
  projectTabs?: (ctx: { project: Project; access: Access; canEdit: boolean; today: string }) => Promise<ProjectTab[]>;
  /** 預設值（還沒在設定頁填寫時用） */
  defaults?: { ownerContext?: string; ownerProfile?: string; primaryProjectSlug?: string; legacyContextKey?: string };
};

// ---------- 畫面用（瀏覽器也會載入，只能放純資料與圖示） ----------

export type NavPage = {
  href: string; label: string; en: string; short?: string; shortEn?: string; hideSm?: boolean;
  /** 排在哪個頁面後面 */ after?: string;
  /** 左側頁面圖示列的圖示（沒給就用格狀圖示） */ icon?: React.ReactNode;
  /** 這一頁是某個專案自己的工具（專案短名）：不放在左側選單，從那個專案頁的分頁進去（模組用 projectTabs 給分頁）。
   *  那個專案不存在、或看的人是合夥人時，照舊放在選單。 */
  project?: string;
  /** 收進左側選單最下面的「更多」 */
  more?: boolean;
};
/** href：這個項目不是這一頁的檢視，而是連到模組自己的另一個網址（例如設定裡的「介紹頁」→ /pages）；到了那個網址，選單仍然算在這一頁底下 */
export type RailItem = { key: string; label: string; en: string; icon: React.ReactNode; href?: string };

export type MetaModule = {
  key: string;
  /** 左側頁面圖示列多出的頁面 */
  pages?: NavPage[];
  /** 頂部列的檢視切換：新頁面的檢視，或加到既有頁面（例如 /monitor）後面的檢視 */
  /** server：這頁的檢視要伺服器依網址重新準備資料（例如整個畫面不同），切換時走一般換頁，不只改網址 */
  rails?: Record<string, { def?: string; server?: boolean; items: RailItem[] }>;
  /** 手機版底部分頁列最左邊的兩個分頁（沒有就用點子庫、專案） */
  mobileTabs?: { href: string; label: string; en: string; icon: React.ReactNode }[];
  /** 系統紀錄（sys_events.source）的名稱 */
  sourceLabels?: Record<string, [string, string]>;
  /** AI 用量（ai_usage.purpose）的名稱與算在哪個產品（成本頁） */
  purposeLabels?: Record<string, { zh: string; en: string; product?: string }>;
};
