// 模組（外掛）介面：核心功能是通用的，個人產品（例如自己的 App 的封測回報、私人工具）
// 寫成模組註冊在 lib/modules/server.ts／client.tsx，核心程式不用知道它們的存在。
// 公開版的這兩個檔案是空清單（server.public.ts／client.public.tsx），私人版列出自己的模組。

import type { Issue, SysEvent } from "../healthLogic";
import type { CheckResult } from "../monitorLogic";

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
  /** 產品監控（每 5 分鐘） */
  monitor?: { products: () => MonitorProduct[]; run: () => Promise<MonitorOutcome[]> };
  /** 每週健康檢查多檢查的項目 */
  health?: (ctx: { events: SysEvent[]; now: number; since: number }) => Promise<Issue[]>;
  /** 右上角鈴鐺的待處理項目 */
  bell?: BellDef[];
  /** Telegram 的其他存放地點 */
  telegram?: TgDestination;
  /** 專案詳細頁：這個專案的回報時間（最近 12 週，畫每週數量） */
  projectFeedback?: (slug: string, sinceIso: string) => Promise<string[] | null>;
  /** 預設值（還沒在設定頁填寫時用） */
  defaults?: { ownerContext?: string; ownerProfile?: string; primaryProjectSlug?: string; legacyContextKey?: string };
};

// ---------- 畫面用（瀏覽器也會載入，只能放純資料與圖示） ----------

export type NavPage = { href: string; label: string; en: string; short?: string; shortEn?: string; hideSm?: boolean; /** 排在哪個頁面後面 */ after?: string; /** 左側頁面圖示列的圖示（沒給就用格狀圖示） */ icon?: React.ReactNode };
export type RailItem = { key: string; label: string; en: string; icon: React.ReactNode };

export type MetaModule = {
  key: string;
  /** 左側頁面圖示列多出的頁面 */
  pages?: NavPage[];
  /** 頂部列的檢視切換：新頁面的檢視，或加到既有頁面（例如 /monitor）後面的檢視 */
  rails?: Record<string, { def?: string; items: RailItem[] }>;
  /** 手機版底部分頁列最左邊的兩個分頁（沒有就用點子庫、專案） */
  mobileTabs?: { href: string; label: string; en: string; icon: React.ReactNode }[];
  /** 系統紀錄（sys_events.source）的名稱 */
  sourceLabels?: Record<string, [string, string]>;
  /** AI 用量（ai_usage.purpose）的名稱與算在哪個產品（成本頁） */
  purposeLabels?: Record<string, { zh: string; en: string; product?: string }>;
};
