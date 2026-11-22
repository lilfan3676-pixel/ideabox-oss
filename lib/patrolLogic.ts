// Threads 海巡：純函式（有單元測試）。抓取、AI 呼叫、存圖片在 patrol.ts。
// 做的事：把抓回來的高流量貼文整理成「共同點」（程式算的）＋每種類型一個模板（AI 寫骨架）。
// 重點：這是從貼文推回來的觀察，不是平台公布的演算法；樣本太少就不下結論。

export const POST_TYPES = [
  { key: "question", label: ["提問互動", "Question"], hint: "丟一個大家都答得出來的問題，請大家留言" },
  { key: "story", label: ["故事自白", "Story"], hint: "講自己或身邊真的發生的一件事" },
  { key: "contrary", label: ["反直覺觀點", "Contrarian"], hint: "講一個跟大家以為的相反的看法" },
  { key: "list", label: ["清單整理", "List"], hint: "幾個重點、工具、地方一次列出來" },
  { key: "howto", label: ["教學步驟", "How-to"], hint: "教人怎麼做到一件事" },
  { key: "result", label: ["成果數字", "Result"], hint: "用成果或具體數字當主角" },
  { key: "trend", label: ["時事跟風", "Trend"], hint: "接時事、節日或正在紅的話題" },
  { key: "relate", label: ["幽默共鳴", "Relatable"], hint: "一句讓人想說「我也是」的話、吐槽或迷因" },
] as const satisfies readonly { key: string; label: [string, string]; hint: string }[];
export type PostType = (typeof POST_TYPES)[number]["key"];
export const TYPE_KEYS = POST_TYPES.map((t) => t.key) as PostType[];
export const isPostType = (v: unknown): v is PostType => typeof v === "string" && (TYPE_KEYS as string[]).includes(v);
export const typeLabel = (key: string | null): [string, string] => POST_TYPES.find((t) => t.key === key)?.label ?? ["沒分類", "Unsorted"];

export const MAX_POSTS = 80; // 一次分析最多幾篇
export const AI_POSTS = 50; // 交給 AI 分類的篇數（互動高的先）
export const KEEP_POSTS = 24; // 存下來顯示在畫面上的篇數
export const MAX_IMAGES = 4; // 每篇最多留幾張圖
export const MIN_SAMPLE = 15; // 少於這麼多篇就不比較前段班
export const DEFAULT_GENERAL = ["大學生", "上班族", "感情", "創業", "生活"];
export const PATROL_STALE_MS = 15 * 60_000;

export type PatrolPost = {
  url: string;
  author: string | null;
  /** 保留換行（要看分行與長度），最多 800 字 */
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  views: number | null;
  at: string | null;
  /** 分析時是原始圖片網址，存檔後換成 Storage 路徑 */
  images: string[];
  type: PostType | null;
  /** 是這批貼文中位數的幾倍 */
  x: number | null;
};
export type PatrolTemplate = { type: PostType; skeleton: string; why: string; refs: { url: string; author: string | null }[] };
export type TypeCount = { key: PostType; n: number; x: number | null };
export type Side = { chars: number; lines: number; replyRate: number; question: number; image: number; link: number };
export type PatrolStats = { n: number; enough: boolean; top?: Side; rest?: Side; hours?: { from: number; share: number } | null };
export type PatrolResult = { summary: string; stats: PatrolStats; types: TypeCount[]; templates: PatrolTemplate[]; posts: PatrolPost[] };
export type PatrolReport = {
  id: string;
  /** null＝不限領域的熱門 */
  project_id: string | null;
  created_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  keywords: string[];
  post_count: number;
  result: PatrolResult | null;
  error: string | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 整理內文：保留換行，行內多個空白併成一個，連續空行最多留一行 */
export function tidyText(raw: string, max = 800): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** 互動分數：留言最重（要打字），轉發其次，按讚最輕 */
export const engagement = (p: Pick<PatrolPost, "likes" | "replies" | "reposts">): number => p.likes + p.replies * 3 + p.reposts * 2;

export function median(list: number[]): number {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function imagesOf(r: Record<string, unknown>): string[] {
  if (/video/i.test(str(r.media_type))) return []; // 影片的網址不是圖片
  const list = [...(Array.isArray(r.media_urls) ? r.media_urls : []), r.media_url];
  const out: string[] = [];
  for (const u of list) {
    const s = str(u).trim();
    if (!/^https:\/\/\S+$/.test(s) || /\.mp4(\?|$)/i.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

/** Apify 回傳的資料列 → 貼文：只留原創貼文（不要回覆、轉發），去重，照互動排，算出每篇是這批中位數的幾倍 */
export function toPatrolPosts(items: unknown[]): PatrolPost[] {
  const seen = new Set<string>();
  const posts: PatrolPost[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (r.record_type && r.record_type !== "post") continue;
    if (r.is_reply === true || r.is_repost === true) continue;
    const url = str(r.post_url);
    const text = tidyText(str(r.text_content));
    if (!/^https:\/\/(www\.)?threads\.(com|net)\//.test(url) || text.replace(/\s/g, "").length < 10) continue;
    const key = str(r.post_code) || url;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push({
      url,
      author: str(r.username) || null,
      text,
      likes: num(r.like_count),
      replies: num(r.reply_count),
      reposts: num(r.repost_count),
      views: typeof r.view_count === "number" && r.view_count > 0 ? r.view_count : null,
      at: str(r.created_at) || null,
      images: imagesOf(r),
      type: null,
      x: null,
    });
  }
  const sorted = posts.sort((a, b) => engagement(b) - engagement(a)).slice(0, MAX_POSTS);
  const mid = median(sorted.map(engagement));
  for (const p of sorted) p.x = mid > 0 ? Math.round((engagement(p) / mid) * 10) / 10 : null;
  return sorted;
}

/** 台北時間的幾點（0～23）；時間看不懂回傳 null */
export function taipeiHour(at: string | null): number | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? new Date(t + 8 * 3_600_000).getUTCHours() : null;
}

const ASK = /[？?]\s*$|想問|請問大家|大家(覺得|會|都|有沒有|怎麼)|你們(覺得|會|都|有沒有|怎麼)|留言(告訴|跟我說|\+1|＋1)|有人(跟我)?一樣|有沒有人/;

export function features(p: Pick<PatrolPost, "text" | "likes" | "replies" | "images">) {
  const lines = p.text.split("\n").filter((l) => l.trim());
  const tail = lines.slice(-2).join("\n");
  return {
    chars: p.text.replace(/\s/g, "").length,
    lines: lines.length,
    question: ASK.test(tail),
    link: /https?:\/\//i.test(p.text),
    image: p.images.length > 0,
    replyRate: p.replies / Math.max(1, p.likes),
  };
}

const pct = (list: boolean[]) => (list.length ? Math.round((list.filter(Boolean).length / list.length) * 100) : 0);

function side(posts: PatrolPost[]): Side {
  const f = posts.map(features);
  return {
    chars: Math.round(median(f.map((x) => x.chars))),
    lines: Math.round(median(f.map((x) => x.lines))),
    replyRate: Math.round(median(f.map((x) => x.replyRate)) * 1000) / 1000,
    question: pct(f.map((x) => x.question)),
    image: pct(f.map((x) => x.image)),
    link: pct(f.map((x) => x.link)),
  };
}

/** 前段班最集中的 3 小時（台北時間）；有時間的不到 5 篇就不算 */
function hotHours(top: PatrolPost[]): { from: number; share: number } | null {
  const hours = top.map((p) => taipeiHour(p.at)).filter((h): h is number => h !== null);
  if (hours.length < 5) return null;
  let best = { from: 0, n: -1 };
  for (let h = 0; h < 24; h++) {
    const n = hours.filter((x) => (x - h + 24) % 24 < 3).length;
    if (n > best.n) best = { from: h, n };
  }
  return { from: best.from, share: Math.round((best.n / hours.length) * 100) };
}

/** 互動前 20%（至少 5 篇）跟其他貼文比。posts 要已經照互動排好 */
export function patrolStats(posts: PatrolPost[]): PatrolStats {
  if (posts.length < MIN_SAMPLE) return { n: posts.length, enough: false };
  const cut = Math.max(5, Math.ceil(posts.length * 0.2));
  const top = posts.slice(0, cut);
  return { n: posts.length, enough: true, top: side(top), rest: side(posts.slice(cut)), hours: hotHours(top) };
}

export type Finding = { key: string; value: [string, string]; label: [string, string] };

/** 畫面上面那排數字卡 */
export function findings(s: PatrolStats): Finding[] {
  if (!s.enough || !s.top || !s.rest) return [];
  const { top, rest } = s;
  const out: Finding[] = [
    { key: "chars", value: [`${top.chars} 字`, `${top.chars} chars`], label: [`前段班的長度（其他 ${rest.chars} 字）`, `Typical length up top (others ${rest.chars})`] },
    { key: "lines", value: [`${top.lines} 行`, `${top.lines} lines`], label: [`前段班分幾行（其他 ${rest.lines} 行）`, `Lines up top (others ${rest.lines})`] },
  ];
  if (rest.replyRate > 0 && top.replyRate > 0) {
    const r = Math.round((top.replyRate / rest.replyRate) * 10) / 10;
    out.push({ key: "reply", value: [`${r} 倍`, `${r}x`], label: ["留言÷讚，跟其他貼文比", "Replies per like vs the rest"] });
  }
  out.push({ key: "question", value: [`${top.question}%`, `${top.question}%`], label: [`結尾是問句或請大家留言（其他 ${rest.question}%）`, `End with a question or an ask (others ${rest.question}%)`] });
  out.push({ key: "image", value: [`${top.image}%`, `${top.image}%`], label: [`有附圖（其他 ${rest.image}%）`, `Have an image (others ${rest.image}%)`] });
  if (s.hours) {
    const to = (s.hours.from + 3) % 24;
    out.push({ key: "hours", value: [`${s.hours.from}–${to || 24} 點`, `${s.hours.from}:00–${to || 24}:00`], label: [`最集中的發文時段（前段班的 ${s.hours.share}%）`, `Busiest posting window (${s.hours.share}% of the top)`] });
  }
  return out;
}

/** 程式看得出來的白話結論（差距夠大才講） */
export function takeaways(s: PatrolStats): [string, string][] {
  if (!s.enough || !s.top || !s.rest) return [];
  const { top, rest } = s;
  const out: [string, string][] = [];
  if (rest.chars > 0 && top.chars <= rest.chars * 0.75) out.push(["前段班明顯比較短。", "The top posts are clearly shorter."]);
  else if (rest.chars > 0 && top.chars >= rest.chars * 1.35) out.push(["前段班反而比較長，這個領域願意讀長文。", "The top posts run longer here."]);
  if (top.question - rest.question >= 15) out.push(["結尾丟問題或請大家留言的，比較容易進前段班。", "Ending on a question or an ask shows up more at the top."]);
  if (rest.replyRate > 0 && top.replyRate / rest.replyRate >= 1.5) out.push(["前段班的留言比例高很多：能讓人回話的貼文走得最遠。", "Top posts draw far more replies per like."]);
  if (top.image - rest.image >= 15) out.push(["有圖的比較常出現在前段班。", "Posts with images show up more at the top."]);
  else if (rest.image - top.image >= 15) out.push(["純文字的反而比較常進前段班。", "Text-only posts do better here."]);
  if (top.link <= 5 && rest.link >= top.link) out.push(["前段班幾乎沒有人放連結。", "Almost no top post carries a link."]);
  return out;
}

/** 各類型的篇數與「這類的中位數是整批的幾倍」（篇數多的在前） */
export function typeCounts(posts: PatrolPost[]): TypeCount[] {
  const out: TypeCount[] = [];
  for (const key of TYPE_KEYS) {
    const mine = posts.filter((p) => p.type === key);
    if (!mine.length) continue;
    const xs = mine.map((p) => p.x).filter((x): x is number => x !== null);
    out.push({ key, n: mine.length, x: xs.length ? Math.round(median(xs) * 10) / 10 : null });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** 給 AI 看的貼文清單：編號＋互動數＋內文（換行用 ⏎ 表示，AI 才看得到分行） */
export function postsForPrompt(posts: PatrolPost[]): string {
  return posts
    .slice(0, AI_POSTS)
    .map((p, i) => `[${i + 1}] ♥${p.likes} 💬${p.replies} 🔁${p.reposts}${p.images.length ? " 🖼" : ""}｜${p.text.slice(0, 500).replace(/\n/g, " ⏎ ")}`)
    .join("\n");
}

type RawPatrol = { summary?: unknown; types?: unknown; templates?: unknown };

/** 模板骨架：保留換行，拿掉 Markdown 粗體，最多 12 行、400 字 */
export function tidySkeleton(raw: string): string {
  return tidyText(raw.replace(/\*\*/g, "").replace(/ ?⏎ ?/g, "\n"), 400).split("\n").slice(0, 12).join("\n").trim();
}

/**
 * AI 結果整理：把類型標回貼文（不在清單裡的類型丟掉）；模板一種類型一個，
 * 而且那種類型至少要有 2 篇（只有 1 篇就歸納不出骨架）；引用的編號換回真的貼文。
 */
export function applyPatrol(raw: RawPatrol, posts: PatrolPost[]): { summary: string; templates: PatrolTemplate[]; types: TypeCount[] } {
  for (const t of Array.isArray(raw?.types) ? (raw.types as { n?: unknown; type?: unknown }[]) : []) {
    const p = posts[Number(t?.n) - 1];
    if (p && isPostType(t?.type)) p.type = t.type;
  }
  const types = typeCounts(posts);
  const templates: PatrolTemplate[] = [];
  for (const t of Array.isArray(raw?.templates) ? (raw.templates as { type?: unknown; skeleton?: unknown; why?: unknown; refs?: unknown }[]) : []) {
    if (!isPostType(t?.type) || templates.some((x) => x.type === t.type)) continue;
    if ((types.find((c) => c.key === t.type)?.n ?? 0) < 2) continue;
    const skeleton = tidySkeleton(str(t.skeleton));
    if (skeleton.length < 10) continue;
    const refs: PatrolTemplate["refs"] = [];
    for (const n of Array.isArray(t.refs) ? t.refs : []) {
      const p = posts[Number(n) - 1];
      if (p && !refs.some((r) => r.url === p.url)) refs.push({ url: p.url, author: p.author });
      if (refs.length >= 3) break;
    }
    templates.push({ type: t.type, skeleton, why: str(t.why).replace(/\s+/g, " ").trim().slice(0, 200), refs });
  }
  const rank = (k: PostType) => types.find((c) => c.key === k)?.x ?? 0;
  templates.sort((a, b) => rank(b.type) - rank(a.type));
  return { summary: str(raw?.summary).replace(/\s+/g, " ").trim().slice(0, 300), templates, types };
}

/** 寫草稿時交給 AI 的模板說明 */
export function templateForPrompt(t: { type: string; skeleton: string }): string {
  const info = POST_TYPES.find((x) => x.key === t.type);
  return [
    `照這個「${info?.label[0] ?? "貼文"}」模板的骨架寫${info ? `（${info.hint}）` : ""}。`,
    "方括號裡是那個位置要放什麼，換成這次主題的真實內容；分行、長度、開頭和結尾的做法照骨架，成品裡不可以留下方括號或說明文字。",
    t.skeleton,
  ].join("\n");
}

/** 「AI 排這週」的參考：這週 Threads 上哪幾種貼文表現最好 */
export function patrolForPlan(r: Pick<PatrolResult, "types" | "stats"> | null): string {
  if (!r) return "";
  const best = r.types.filter((t) => t.n >= 2 && t.x !== null).sort((a, b) => (b.x ?? 0) - (a.x ?? 0)).slice(0, 3);
  if (!best.length) return "";
  return [...best.map((t) => `・${typeLabel(t.key)[0]}：${t.n} 篇，中位數是整批的 ${t.x} 倍`), ...takeaways(r.stats).slice(0, 3).map((t) => `・${t[0]}`)].join("\n");
}

/** 「抓取中」太久（函式被中斷）當作失敗 */
export function patrolStatus(r: Pick<PatrolReport, "status" | "created_at">, now = Date.now()): PatrolReport["status"] {
  return r.status === "running" && now - Date.parse(r.created_at) > PATROL_STALE_MS ? "failed" : r.status;
}

/** 每個範圍（專案 id 或 general）最新的一份完成的報告，以及最新一筆的狀態 */
export function latestByScope(rows: PatrolReport[], now = Date.now()): Record<string, { done: PatrolReport | null; state: PatrolReport["status"] | null; error: string | null }> {
  const out: Record<string, { done: PatrolReport | null; state: PatrolReport["status"] | null; error: string | null }> = {};
  for (const r of [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const key = r.project_id ?? "general";
    const slot = (out[key] ??= { done: null, state: null, error: null });
    if (slot.state === null) {
      slot.state = patrolStatus(r, now);
      slot.error = slot.state === "failed" ? r.error ?? "逾時中斷" : null;
    }
    if (!slot.done && r.status === "done" && r.result) slot.done = r;
  }
  return out;
}
