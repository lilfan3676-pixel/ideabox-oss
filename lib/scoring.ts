// 評分與分類的純函式（有單元測試）

export const CATEGORIES = ["arx_feature", "startup_idea", "marketing", "mindset", "other", "ui_design", "github"] as const;
export const IDEA_CATEGORIES = ["arx_feature", "startup_idea", "marketing", "mindset", "other"] as const;
export type CategoryKey = (typeof CATEGORIES)[number];

export function clampScore(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

export function normalizeCategory(v: unknown): CategoryKey {
  return CATEGORIES.includes(v as CategoryKey) ? (v as CategoryKey) : "other";
}

/** 綜合分數：專案相關度 40%、可行性 30%、市場潛力 30%，取到小數一位。 */
export function totalScore(related: number | null, feas: number | null, market: number | null): number | null {
  const parts: Array<[number | null, number]> = [
    [related, 0.4],
    [feas, 0.3],
    [market, 0.3],
  ];
  const valid = parts.filter(([v]) => v !== null) as Array<[number, number]>;
  if (!valid.length) return null;
  const weight = valid.reduce((s, [, w]) => s + w, 0);
  const sum = valid.reduce((s, [v, w]) => s + v * w, 0);
  return Math.round((sum / weight) * 10) / 10;
}

// AI 偶爾把工具參數的標記（</summary>、<parameter …>）或欄位說明當成內容寫進來，存檔前清掉
const LEAKED_MARKUP = /<\/?(?:parameter|invoke|function_calls|antml)\b|<\/(?:summary|category|tags|next_step|score_reason|apply|styles|learn)>/i;
const JUNK = /^(?:\[\s*\]|\{\s*\}|無|没有|沒有|不適用|none|n\/?a|null|undefined|[-—–・.。…]+)$/i;

/** 空白、「[]」「無」這類沒意義的值，或照抄欄位說明的值 */
export function isJunkText(s: string): boolean {
  const t = s.trim();
  return !t || JUNK.test(t) || t.startsWith("只有設計類才填");
}

/** 清理 AI 回傳的一段文字：切掉漏出來的標記、丟掉沒意義的值 */
export function cleanText(v: unknown, maxLen: number): string {
  let s = typeof v === "string" ? v : "";
  const cut = s.search(LEAKED_MARKUP);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.trim();
  return isJunkText(s) ? "" : s.slice(0, maxLen);
}

/** 文字裡有沒有中文字（用來檢查 AI 有沒有照規定寫繁中） */
export const hasCjk = (s: string) => /[\u4e00-\u9fff]/.test(s);

export function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== "string") continue;
    const s = cleanText(t.replace(/^#/, ""), 20);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}

/** 清理字串陣列（風格標籤、值得學的手法） */
export function cleanList(v: unknown, max = 5, maxLen = 40): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    if (typeof t !== "string") continue;
    const s = cleanText(t, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
