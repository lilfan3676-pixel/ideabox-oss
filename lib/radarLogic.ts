// 話題雷達：純函式（有單元測試）。抓取與 AI 呼叫在 radar.ts。

export const MAX_KEYWORDS = 5;
export const MAX_POSTS = 60; // 交給 AI 的貼文上限（依互動數挑前面的）
export const SAVE_MIN_SCORE = 4; // 痛點 AI 評分到這個以上才自動存成點子
export const SAVE_MAX = 3;
export const STALE_MS = 15 * 60_000; // 「抓取中」超過這麼久當作失敗（函式被中斷）

export type RadarPost = { url: string; author: string | null; text: string; likes: number; replies: number; at: string | null; keyword: string | null };
export type RadarItem = { title: string; detail: string; urls: string[] };
export type RadarPain = RadarItem & { score: number };
export type RadarSummary = { overview: string; themes: RadarItem[]; pains: RadarPain[] };
export type RadarReport = {
  id: string;
  project_id: string;
  created_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  keywords: string[];
  post_count: number;
  summary: RadarSummary | null;
  idea_ids: string[];
  error: string | null;
};

/** 關鍵字：逗號、頓號、換行分隔；去掉前後空白與 #、不分大小寫去重、最多 5 個、每個最多 30 字 */
export function cleanKeywords(input: string | string[]): string[] {
  const parts = (Array.isArray(input) ? input : input.split(/[,，、\n]/)).map((s) => s.trim().replace(/^#+/, "").trim().slice(0, 30)).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of parts) {
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Apify 回傳的資料列 → 貼文：只留貼文、去掉太短的與重複的，依互動數（留言比按讚重）排序，最多 60 篇 */
export function toPosts(items: unknown[]): RadarPost[] {
  const seen = new Set<string>();
  const posts: RadarPost[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.record_type && r.record_type !== "post") continue;
    const url = str(r.post_url);
    const text = str(r.text_content).replace(/\s+/g, " ").trim();
    if (!/^https:\/\/(www\.)?threads\.(com|net)\//.test(url) || text.length < 10) continue;
    const key = str(r.post_code) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push({
      url,
      author: str(r.username) || null,
      text: text.slice(0, 400),
      likes: num(r.like_count),
      replies: num(r.reply_count),
      at: str(r.created_at) || null,
      keyword: str(r.keyword) || str(r.search_keyword) || null,
    });
  }
  return posts.sort((a, b) => b.likes + b.replies * 3 - (a.likes + a.replies * 3)).slice(0, MAX_POSTS);
}

/** 給 AI 看的貼文清單：編號＋互動數＋內文。AI 用編號引用，之後換回網址（避免 AI 自己編網址） */
export function postsForPrompt(posts: RadarPost[]): string {
  return posts.map((p, i) => `[${i + 1}] ♥${p.likes} 💬${p.replies}｜${p.text}`).join("\n");
}

type RawItem = { title?: unknown; detail?: unknown; refs?: unknown; score?: unknown };
type RawSummary = { overview?: unknown; themes?: unknown; pains?: unknown };

function cleanItems(list: unknown, posts: RadarPost[], max: number): (RadarItem & { score: number })[] {
  if (!Array.isArray(list)) return [];
  const out: (RadarItem & { score: number })[] = [];
  for (const x of list as RawItem[]) {
    const title = str(x?.title).trim().slice(0, 60);
    if (!title) continue;
    const refs = Array.isArray(x.refs) ? x.refs : [];
    const urls = [...new Set(refs.map((n) => posts[Number(n) - 1]?.url).filter((u): u is string => !!u))].slice(0, 5);
    const score = Math.min(5, Math.max(1, Math.round(num(x.score) || 3)));
    out.push({ title, detail: str(x.detail).trim().slice(0, 300), urls, score });
    if (out.length >= max) break;
  }
  return out;
}

/** AI 結果整理：編號換成真的網址（不存在的編號丟掉）、限制數量與長度、分數 1～5 */
export function cleanSummary(raw: RawSummary, posts: RadarPost[]): RadarSummary {
  return {
    overview: str(raw?.overview).trim().slice(0, 400),
    themes: cleanItems(raw?.themes, posts, 6).map(({ title, detail, urls }) => ({ title, detail, urls })),
    pains: cleanItems(raw?.pains, posts, 8),
  };
}

/** 要自動存成點子的痛點：分數 4 以上、至少有一篇原文佐證，最多 3 個（分數高的先） */
export function painsToSave(pains: RadarPain[]): RadarPain[] {
  return pains
    .filter((p) => p.score >= SAVE_MIN_SCORE && p.urls.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SAVE_MAX);
}

/** 存成點子時的內文：痛點＋說明＋原文連結（點子分析會看到這些） */
export function painIdeaText(p: RadarPain, keywords: string[]): string {
  return [`【話題雷達｜${keywords.join("、")}】${p.title}`, p.detail, "", "Threads 原文：", ...p.urls].filter((s, i) => s || i === 2).join("\n");
}

/** 「抓取中」太久（函式被中斷）當作失敗 */
export function effectiveStatus(r: Pick<RadarReport, "status" | "created_at">, now = Date.now()): RadarReport["status"] {
  return r.status === "running" && now - Date.parse(r.created_at) > STALE_MS ? "failed" : r.status;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 週報的 Telegram 訊息 */
export function radarTelegram(projectName: string, slug: string, s: RadarSummary, postCount: number, saved: number, appUrl: string): string {
  const lines = [`📡 <b>${escHtml(projectName)} 話題雷達</b>（看了 ${postCount} 篇 Threads）`];
  if (s.overview) lines.push(escHtml(s.overview));
  if (s.pains.length) lines.push("", "常見痛點：", ...s.pains.slice(0, 3).map((p) => `• ${escHtml(p.title)}`));
  if (saved) lines.push("", `💡 挑了 ${saved} 個存進點子庫`);
  if (appUrl) lines.push("", `${appUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(slug)}`);
  return lines.join("\n");
}
