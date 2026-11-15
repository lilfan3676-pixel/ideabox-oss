// Telegram 訊息分流：點子庫 or 模組提供的其他存放地點（關鍵字規則，純函式方便測試）
// 沒有其他存放地點時一律存進點子庫。

export type Route = "ideas" | "ask" | (string & {});

// 在講創業、產品、行銷等點子
const IDEA_WORDS = [
  "創業", "新創", "創辦人", "產品", "行銷", "用戶", "使用者", "留存", "募資", "投資", "功能", "介面", "程式", "工程師",
  "商業模式", "流量", "經營", "獲利", "營收", "訂閱", "社群經營", "成長", "轉換率", "工具", "自動化", "效率", "點子",
];
const IDEA_LATIN = [/\bapp\b/i, /\bai\b/i, /\bui\b/i, /\bux\b/i, /\bsaas\b/i, /\bmvp\b/i, /\bstartup\b/i, /\bgithub\b/i, /\bapi\b/i];

const GITHUB_URL = /^https?:\/\/(www\.)?github\.com\//i;

export type RouteResult = { route: Route; alt: number; ideas: number };
/** 其他存放地點：key 與「有多像要存到這裡」的分數 */
export type RouteDest = { key: string; score: (all: string, urls: string[]) => number };

/** 點子相關字的分數 */
export function ideaScore(all: string, urls: string[]): number {
  let n = IDEA_WORDS.filter((w) => all.includes(w)).length + IDEA_LATIN.filter((re) => re.test(all)).length;
  if (urls.some((u) => GITHUB_URL.test(u))) n += 3;
  return n;
}

/**
 * 依關鍵字分數決定（alt = 分數最高的其他存放地點）：
 * - alt 3 分以上且比點子多 2 分以上 → 存到 alt；alt 2 分以上、點子 0 分 → 存到 alt
 * - alt 0 分 → 點子庫；點子比 alt 多 2 分以上 → 點子庫
 * - 其他（兩邊都有、或 alt 只有 1 分）→ 問你
 * - unreadable（有連結但讀不到內容）且兩邊都 0 分 → 問你（沒有線索，不要猜成點子）
 */
export function routeMessage(text: string, urls: string[], fetched = "", dests: RouteDest[] = [], opts: { unreadable?: boolean } = {}): RouteResult {
  const all = `${text}\n${fetched}`;
  const ideas = ideaScore(all, urls);
  const best = dests.map((d) => ({ key: d.key, n: d.score(all, urls) })).sort((a, b) => b.n - a.n)[0];
  const alt = best?.n ?? 0;
  let route: Route;
  if (best && alt >= 3 && alt >= ideas + 2) route = best.key;
  else if (best && alt >= 2 && ideas === 0) route = best.key;
  else if (alt === 0 && ideas === 0 && opts.unreadable && dests.length) route = "ask";
  else if (alt === 0) route = "ideas";
  else if (ideas >= alt + 2) route = "ideas";
  else route = "ask";
  return { route, alt, ideas };
}

/** 強制指定：開頭打其他存放地點的指定字 → 存到那裡，「點子」→ 點子庫 */
export function forcedRoute(text: string, dests: { key: string; prefixes: string[] }[] = []): { route: string; body: string } | null {
  const words = [...dests.flatMap((d) => d.prefixes.flatMap((p) => [p, `/${p}`])), "點子", "/idea"];
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const m = text.match(new RegExp(`^(${words.map(esc).join("|")})(?:@\\w+)?[\\s：:]*([\\s\\S]*)$`, "i"));
  if (!m) return null;
  const k = m[1].toLowerCase().replace(/^\//, "");
  if (k === "點子" || k === "idea") return { route: "ideas", body: m[2].trim() };
  const d = dests.find((x) => x.prefixes.some((p) => p.toLowerCase() === k));
  return d ? { route: d.key, body: m[2].trim() } : null;
}

/** 讀到的連結內容有沒有實質內文：只有「192 likes, 320 comments - 某某 於 October 31」這種空殼不算 */
export function hasContent(fetched: string | null | undefined): boolean {
  if (!fetched) return false;
  const t = fetched
    .replace(/[\d,.]+\s*[KkMm萬]?\s*(likes?|comments?|個讚|讚|則留言|留言|followers?|位追蹤者)/gi, "")
    .replace(/[-–—]?\s*[\w.]+\s*(on|於)\s+[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}/g, "") // 「- 帳號 於 October 31, 2026」
    .replace(/\b(Instagram|Threads|Facebook|TikTok|Log in|Sign up)\b/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s\-–—:：·•|@_.,"'“”()（）]+/g, "");
  return t.length >= 6;
}
