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

/** 綜合分數：對最適合專案的適用度 40%、做得到嗎 30%、值不值得 30%，取到小數一位。
 *  後兩項的意思跟著評分角度換（見 LENS_INFO）。 */
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

// ---------- 第 2 版評分：每個專案各一分＋依「評分角度」換另外兩項 ----------

/** 目前的評分版本；`ideas.scoring.v` 比這個小（或沒有）就是舊算法評的 */
export const SCORING_VERSION = 2;

/** 評分角度：這則點子主要該從哪個面向看（跟分類分開，分類決定放哪裡，角度決定怎麼評） */
export const LENSES = ["design", "feature", "marketing", "operations", "business", "insight"] as const;
export type Lens = (typeof LENSES)[number];

export type Scoring = {
  v: number;
  lens?: Lens;
  /** 專案 id → 這則點子對那個專案的適用度（1～10） */
  projects?: Record<string, number>;
};

type Bi = { zh: string; en: string };
/** 每個角度的名稱，以及「做得到嗎」「值不值得」兩項在這個角度下叫什麼 */
export const LENS_INFO: Record<Lens, { name: Bi; ease: Bi; value: Bi; easeAsk: string; valueAsk: string }> = {
  design: {
    name: { zh: "介面／網站設計", en: "UI / web design" },
    ease: { zh: "好實作", en: "Easy to build" },
    value: { zh: "參考價值", en: "Reference value" },
    easeAsk: "實作容易度（10=很容易做出來）",
    valueAsk: "設計品質與參考價值（10=非常值得學）",
  },
  feature: {
    name: { zh: "產品功能", en: "Product feature" },
    ease: { zh: "好實作", en: "Easy to build" },
    value: { zh: "使用者價值", en: "User value" },
    easeAsk: "小團隊做出來的容易度（10=幾天就能做完）",
    valueAsk: "對使用者的價值：會不會讓人更想用、更常回來（10=很有感）",
  },
  marketing: {
    name: { zh: "行銷成長", en: "Marketing" },
    ease: { zh: "好執行", en: "Easy to run" },
    value: { zh: "預期成效", en: "Expected impact" },
    easeAsk: "執行門檻：要花的錢、時間、人力（10=幾乎不花成本，這週就能做）",
    valueAsk: "預期成效：能帶來多少曝光、使用者或營收（10=效果很大）",
  },
  operations: {
    name: { zh: "營運流程", en: "Operations" },
    ease: { zh: "好導入", en: "Easy to adopt" },
    value: { zh: "省時省錢", en: "Time & cost saved" },
    easeAsk: "導入容易度：要不要改流程、學新工具（10=馬上就能用）",
    valueAsk: "能省下多少時間、錢或降低多少風險（10=省很多）",
  },
  business: {
    name: { zh: "商業題目", en: "Business idea" },
    ease: { zh: "可行性", en: "Feasibility" },
    value: { zh: "市場潛力", en: "Market potential" },
    easeAsk: "小團隊資源有限下的可行性（10=很做得起來）",
    valueAsk: "市場潛力：需求多大、有沒有人願意付錢（10=很大）",
  },
  insight: {
    name: { zh: "觀點心法", en: "Insight" },
    ease: { zh: "好上手", en: "Easy to apply" },
    value: { zh: "啟發價值", en: "Insight value" },
    easeAsk: "能不能馬上用在手上的事（10=今天就能照著做）",
    valueAsk: "啟發價值：有沒有新觀點、會不會改變做法（10=很有啟發）",
  },
};

export function normalizeLens(v: unknown): Lens | null {
  return LENSES.includes(v as Lens) ? (v as Lens) : null;
}

/** 這則點子的評分角度：設計類一律是設計；其他用 AI 選的，沒有就照分類給預設 */
export function lensFor(category: CategoryKey | null | undefined, raw: unknown): Lens {
  if (category === "ui_design" || category === "github") return "design";
  const picked = normalizeLens(raw);
  if (picked) return picked;
  if (category === "arx_feature") return "feature";
  if (category === "marketing") return "marketing";
  if (category === "startup_idea") return "business";
  return "insight";
}

/** 畫面與 Telegram 上三項分數的名稱。舊算法評的（沒有角度）沿用原本的「可行／市場」 */
export function axisLabels(lens: Lens | null | undefined, lang: "zh" | "en" = "zh"): { ease: string; value: string; lens: string | null } {
  if (!lens) return lang === "en" ? { ease: "Feasible", value: "Market", lens: null } : { ease: "可行", value: "市場", lens: null };
  const i = LENS_INFO[lens];
  return { ease: i.ease[lang], value: i.value[lang], lens: i.name[lang] };
}

/** 整理 AI 回的每個專案分數：只留對得到的專案（用名稱對），分數夾在 1～10 */
export function cleanProjectScores(raw: unknown, projects: { id: string; name: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(raw)) return out;
  const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]));
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const id = byName.get(String((r as { project?: unknown }).project ?? "").trim().toLowerCase());
    const n = clampScore((r as { score?: unknown }).score);
    if (id && n !== null && !(id in out)) out[id] = n;
  }
  return out;
}

/** 最適合的專案：有指定專案就看那個，沒有就取分數最高的（同分取清單上排前面的） */
export function bestFit(scores: Record<string, number> | null | undefined, focusId?: string | null, order: string[] = []): { id: string; score: number } | null {
  if (!scores) return null;
  // 有指定專案就只看那個專案；AI 漏評它的話回 null（呼叫的地方改用 AI 另外給的分數），不拿別的專案頂替
  if (focusId) return focusId in scores ? { id: focusId, score: scores[focusId] } : null;
  const ids = [...order.filter((id) => id in scores), ...Object.keys(scores).filter((id) => !order.includes(id))];
  let best: { id: string; score: number } | null = null;
  for (const id of ids) if (!best || scores[id] > best.score) best = { id, score: scores[id] };
  return best;
}

/** 這則是不是舊算法評的（要不要重評） */
export const isOldScoring = (s: Scoring | null | undefined) => !s || !(s.v >= SCORING_VERSION);

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
