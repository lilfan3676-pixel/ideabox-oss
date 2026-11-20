// 爆款靈感庫的判斷邏輯（純函式）：開頭公式歸類、算「是那個帳號平常的幾倍」、排序與統計。
// 重點：看倍數不看觀看數。大帳號的 40 萬是平常的一天，小帳號的 40 萬才是找到了什麼。

export type Swipe = {
  id: string;
  project_id: string;
  account: string;
  hook: string;
  url: string | null;
  views: number | null;
  median_views: number | null;
  likes: number | null;
  formula: string;
  note: string;
  source: "manual" | "radar";
  created_at: string;
};

/** 開頭公式：名稱、怎麼認、自己寫的時候怎麼用。順序就是判斷順序（前面的優先） */
export const HOOK_FORMULAS: { key: string; label: [string, string]; re: RegExp; tip: string }[] = [
  { key: "untold", label: ["沒人告訴你", "Nobody tells you"], re: /沒(有)?人(會)?(告訴|跟你說|教你|提醒)|沒人講|不會有人告訴/, tip: "講一件大家都遇到、但沒人明講的事。" },
  { key: "cost", label: ["代價自白", "Cost confession"], re: /我(花了|浪費了|賠了|虧了|燒了|損失|白白)|花了我|才發現|後悔|做錯了|踩(過|到)(的)?(坑|雷)|差點/, tip: "先講你付出的代價（時間、錢、機會），再講學到什麼。" },
  { key: "stop", label: ["別再這樣做", "Stop doing this"], re: /^(別|不要|停止|千萬別|拜託不要)(再)?|別再|不要再|停止再/, tip: "直接叫人停止一個常見的做法，再給替代方案。" },
  { key: "number", label: ["數字結果", "Number result"], re: /\d+\s?(天|週|個月|年|小時|分鐘|秒)[^。！？]{0,12}(從|就|內|做到|變成|賺|瘦|漲|破|達到)|從\s?\d[\d,.萬千]*\s?(到|變成)|\d[\d,.]*\s?(萬|千|k|K|%|倍|人|元|塊)/, tip: "用一個具體的數字和時間開場，數字要是真的。" },
  { key: "contrary", label: ["反直覺", "Contrarian"], re: /其實(不|沒)|反而|根本不(是|用|需要)|不是[^，。]{1,12}(而是|是因為)|故意(不|沒)|為什麼(我|我們)(不|故意|拒絕)|錯了|你以為/, tip: "講一個跟大家以為的相反的觀點，然後證明它。" },
  { key: "question", label: ["提問", "Question"], re: /[？?]\s*$|^(為什麼|怎麼|如何|到底|你有沒有|有沒有人|是不是|該不該|誰)/, tip: "問一個目標對象心裡真的會問的問題。" },
  { key: "list", label: ["清單", "List"], re: /^\s?\d+\s?(個|種|件|招|步|點|樣)|[一二三四五六七八九十兩]\s?(個|種|件|招|步|點|樣)[^。]{0,10}(方法|技巧|原因|錯誤|重點|地方|習慣|工具)/, tip: "幾個重點一次講完，適合做成輪播。" },
  { key: "before_after", label: ["前後對比", "Before and after"], re: /以前[^。]{1,24}(現在|後來)|之前[^。]{1,24}(現在|之後)|一年前|三個月前|剛開始[^。]{1,20}現在/, tip: "把以前和現在放在一起比。" },
  { key: "scene", label: ["直接進場景", "Cold open"], re: /^(那天|昨天|上週|今天早上|凌晨|剛剛|就在剛才|我朋友|我媽|我老闆|客人|有個)/, tip: "不鋪陳，從故事正在發生的那一刻開始講。" },
  { key: "call", label: ["點名對象", "Call out"], re: /^(如果你|給(所有|每個|正在)|還在[^，。]{1,12}的(你|人)|[^，。]{2,10}的(你|人)(注意|看這裡|一定要))/, tip: "第一句就說這是講給誰聽的。" },
];
export const OTHER_FORMULA: [string, string] = ["其他", "Other"];
export const formulaLabel = (key: string): [string, string] => HOOK_FORMULAS.find((f) => f.key === key)?.label ?? OTHER_FORMULA;

/** 這句開頭是哪一種公式；都對不到回傳 other（對不到的最值得自己讀一遍，可能是新的寫法） */
export function classifyHook(hook: string): string {
  const t = hook.trim();
  return HOOK_FORMULAS.find((f) => f.re.test(t))?.key ?? "other";
}

/** 是那個帳號平常的幾倍；缺數字就算不出來 */
export function multipleOf(s: Pick<Swipe, "views" | "median_views">): number | null {
  if (!s.views || !s.median_views || s.median_views <= 0) return null;
  return Math.round((s.views / s.median_views) * 10) / 10;
}

/** 3 倍以上才算訊號；1.5 倍以下是那個帳號平常的一天 */
export const SIGNAL = 3;

/** 倍數高的在前；算不出倍數的照讚數、再照時間 */
export function sortSwipes<T extends Pick<Swipe, "views" | "median_views" | "likes" | "created_at">>(list: T[]): T[] {
  return [...list].sort((a, b) => (multipleOf(b) ?? -1) - (multipleOf(a) ?? -1) || (b.likes ?? 0) - (a.likes ?? 0) || b.created_at.localeCompare(a.created_at));
}

/** 3 倍以上的貼文裡，各種公式出現幾次（多的在前，不算「其他」） */
export function formulaCounts(list: Pick<Swipe, "views" | "median_views" | "formula">[]): { key: string; n: number }[] {
  const map = new Map<string, number>();
  for (const s of list) {
    if ((multipleOf(s) ?? 0) < SIGNAL || s.formula === "other") continue;
    map.set(s.formula, (map.get(s.formula) ?? 0) + 1);
  }
  return [...map].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export const parseCount = (v: unknown): number | null => {
  const s = String(v ?? "").replace(/[,，\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(萬|k|K|千|m|M)?$/);
  if (!m) return null;
  const n = +m[1] * (m[2] === "萬" ? 10_000 : m[2] === "千" || m[2] === "k" || m[2] === "K" ? 1_000 : m[2] === "m" || m[2] === "M" ? 1_000_000 : 1);
  return Number.isFinite(n) && n >= 0 && n < 2_000_000_000 ? Math.round(n) : null;
};

export type SwipeInput = { account?: string; hook?: string; url?: string; views?: unknown; median?: unknown; note?: string };

/** 整理表單輸入：數字可以寫「41萬」「18k」；網址只收 http(s) */
export function cleanSwipe(v: SwipeInput): { row: Pick<Swipe, "account" | "hook" | "url" | "views" | "median_views" | "formula" | "note"> } | { error: string } {
  const hook = String(v.hook ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (hook.length < 4) return { error: "開頭那句話要填（照原文貼）" };
  const url = String(v.url ?? "").trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { error: "連結要是 http 開頭的網址" };
  const views = parseCount(v.views);
  const median = parseCount(v.median);
  if (String(v.views ?? "").trim() && views === null) return { error: "觀看數看不懂，寫數字就好，例如 410000 或 41萬" };
  if (String(v.median ?? "").trim() && median === null) return { error: "平常的觀看數看不懂，寫數字就好，例如 11000 或 1.1萬" };
  const account = String(v.account ?? "").trim().replace(/^@+/, "").slice(0, 60);
  return { row: { account: account ? `@${account}` : "", hook, url: url ? url.slice(0, 500) : null, views, median_views: median, formula: classifyHook(hook), note: String(v.note ?? "").trim().slice(0, 300) } };
}

/** 貼文的第一句（話題雷達存進來時用）：取第一行、第一個句號前，最多 80 字 */
export function firstSentence(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  const cut = line.match(/^.{4,80}?[。！？!?]/)?.[0] ?? line.slice(0, 80);
  return cut.trim();
}

/** 給 AI 參考的「最近有效的開頭」：3 倍以上的前幾則，沒有就拿讚數高的。只學形狀，不抄內容 */
export function swipesForPrompt(list: Swipe[], max = 6): string {
  const top = sortSwipes(list).filter((s) => (multipleOf(s) ?? 0) >= SIGNAL || (s.likes ?? 0) > 0).slice(0, max);
  return top.map((s) => `・${formulaLabel(s.formula)[0]}${multipleOf(s) ? `（平常的 ${multipleOf(s)} 倍）` : ""}：「${s.hook.slice(0, 80)}」`).join("\n");
}

export const viewsText = (n: number | null): string => (n === null ? "" : n >= 10_000 ? `${Math.round(n / 1000) / 10} 萬` : n.toLocaleString("en-US"));
