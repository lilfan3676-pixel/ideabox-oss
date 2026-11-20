// 發文排程器的判斷邏輯（純函式，網頁、Telegram、排程共用；不能 import node 模組）
import { parseTime } from "./appTime";
import { isIsoDate } from "./dates";

export const PLATFORMS = ["fb_group", "fb_page", "ig", "dcard", "line_oa"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (s: unknown): s is Platform => typeof s === "string" && (PLATFORMS as readonly string[]).includes(s);
export const PLATFORM_LABEL: Record<Platform, [string, string]> = {
  fb_group: ["FB 社團", "FB group"],
  fb_page: ["FB 粉專", "FB page"],
  ig: ["IG", "Instagram"],
  dcard: ["Dcard", "Dcard"],
  line_oa: ["LINE 官方帳號", "LINE official account"],
};
/** 每個平台為什麼只能提醒、不能自動發（畫面與 Telegram 提醒都用這一份） */
export const PLATFORM_NOTE: Record<Platform, [string, string]> = {
  fb_group: ["FB 社團不開放程式自動發文：時間到會用 Telegram 把文案傳給你，自己貼上去。", "Facebook doesn't let apps post to groups: you'll get the copy on Telegram and post it yourself."],
  fb_page: ["粉專目前也是提醒你自己貼；之後可接 Meta API 自動發文。", "Pages are reminder-only for now; auto-posting via the Meta API can be added later."],
  ig: ["IG 目前也是提醒你自己貼；之後可接 Meta API 自動發文。", "Instagram is reminder-only for now; auto-posting via the Meta API can be added later."],
  dcard: ["Dcard 沒有開放發文的 API：時間到提醒你自己貼。", "Dcard has no posting API: you'll get a reminder and post it yourself."],
  line_oa: ["LINE 官方帳號的動態要在 LINE 後台發：時間到提醒你自己貼。", "LINE posts go out from the LINE console: you'll get a reminder and post it yourself."],
};

/** 貼文格式：一般貼文之外，短影片、輪播、限時動態各有自己的腳本寫法 */
export const FORMATS = ["post", "reel", "carousel", "story"] as const;
export type PostFormat = (typeof FORMATS)[number];
export const isFormat = (s: unknown): s is PostFormat => typeof s === "string" && (FORMATS as readonly string[]).includes(s);
export const FORMAT_LABEL: Record<PostFormat, [string, string]> = {
  post: ["貼文", "Post"],
  reel: ["Reel 短影片", "Reel"],
  carousel: ["輪播", "Carousel"],
  story: ["限時動態", "Story"],
};
export const FORMAT_SHORT: Record<PostFormat, [string, string]> = {
  post: ["貼文", "Post"],
  reel: ["Reel", "Reel"],
  carousel: ["輪播", "Carousel"],
  story: ["限動", "Story"],
};
/** 哪些平台有短影片／輪播／限動；其他平台只有一般貼文 */
export function formatsFor(platform: Platform): PostFormat[] {
  if (platform === "ig" || platform === "fb_page") return [...FORMATS];
  if (platform === "line_oa") return ["post", "carousel"];
  return ["post"];
}
export const formatOf = (p: { format?: string | null }): PostFormat => (isFormat(p.format) ? p.format : "post");

/** 內容類型：一週裡要混著排，不連續兩則同一種（AI 排一週時用，也可以自己選） */
export const KINDS = ["proof", "teach", "opinion", "story", "offer"] as const;
export type PostKind = (typeof KINDS)[number];
export const isKind = (s: unknown): s is PostKind => typeof s === "string" && (KINDS as readonly string[]).includes(s);
export const KIND_LABEL: Record<PostKind, [string, string]> = {
  proof: ["成果證明", "Proof"],
  teach: ["教學", "Teach"],
  opinion: ["觀點", "Opinion"],
  story: ["故事", "Story"],
  offer: ["介紹產品", "Offer"],
};
/** 每種類型在寫什麼（給 AI 排計畫、寫草稿時參考） */
export const KIND_STYLE: Record<PostKind, string> = {
  proof: "成果證明：真的發生的一件事，帶一個數字。",
  teach: "教學：讀者今天就能照著做的一件事。",
  opinion: "觀點：一個有人會不同意的立場，講清楚為什麼。",
  story: "故事：一個有代價的場景（發生了什麼、付出什麼、後來怎樣）。",
  offer: "介紹產品：直接講這是什麼、給誰用、怎麼開始，不用不好意思。",
};

export const POST_STATUSES = ["draft", "scheduled", "posted", "skipped"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const isPostStatus = (s: unknown): s is PostStatus => typeof s === "string" && (POST_STATUSES as readonly string[]).includes(s);
export const STATUS_LABEL: Record<PostStatus, [string, string]> = {
  draft: ["草稿", "Draft"],
  scheduled: ["已排定", "Scheduled"],
  posted: ["已發", "Posted"],
  skipped: ["略過", "Skipped"],
};

export type Post = {
  id: string;
  project_id: string;
  platform: Platform;
  /** 還沒執行 migration-030 時沒有這個欄位，當作一般貼文 */
  format?: PostFormat | null;
  /** 內容類型（migration-031，可以是空的） */
  kind?: PostKind | null;
  /** 成效數字（migration-032）：觀看、觸及、分享…，見 lib/auditLogic.ts */
  metrics?: Record<string, number> | null;
  metrics_at?: string | null;
  target: string;
  due_at: string;
  topic: string;
  body: string;
  image_path: string | null;
  status: PostStatus;
  notified_at: string | null;
  posted_at: string | null;
  source: "manual" | "telegram" | "seed";
  created_at: string;
  updated_at: string;
};

export const DEFAULT_TIME = "20:00";
export const MAX_BODY = 5000;

// ---------- 時間（一律用台北時間顯示與輸入） ----------

/** 台北的日期＋時間 → ISO（存進資料庫用） */
export function dueIso(date: string, time: string): string | null {
  const t = parseTime(time);
  if (!isIsoDate(date) || !t) return null;
  return new Date(`${date}T${t}:00+08:00`).toISOString();
}

/** ISO → 台北的日期與時間 */
export function taipeiParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

export function whenText(iso: string): string {
  const { date, time } = taipeiParts(iso);
  return `${+date.slice(5, 7)}/${+date.slice(8, 10)} ${time}`;
}

// ---------- 一週看板 ----------

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 這一天所在那週的星期一 */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0＝週日
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** 星期一到星期日的 7 個日期 */
export const weekDays = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

// ---------- 平台 ----------

/** 從「發在哪裡」猜平台：中山社團 → FB 社團、IG 限動 → IG… 猜不到就當 FB 社團 */
export function guessPlatform(target: string): Platform {
  const t = target.toLowerCase();
  if (/dcard|狄卡/.test(t)) return "dcard";
  if (/line/.test(t)) return "line_oa";
  if (/(^|[^a-z])ig([^a-z]|$)|instagram|限動|限時動態|reels?/.test(t)) return "ig";
  if (/粉專|粉絲專頁|粉絲團|fan ?page/.test(t)) return "fb_page";
  return "fb_group";
}

/** 從「發在哪裡」猜格式：IG Reel → 短影片、IG 限動 → 限時動態、IG 輪播 → 輪播 */
export function guessFormat(target: string, platform: Platform): PostFormat {
  const t = target.toLowerCase();
  const f: PostFormat = /reels?|短影片|短片/.test(t) ? "reel" : /限動|限時動態|stor(y|ies)/.test(t) ? "story" : /輪播|carousel|多圖/.test(t) ? "carousel" : "post";
  return formatsFor(platform).includes(f) ? f : "post";
}

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

// ---------- Telegram 指令：「<短名> 發文 11/21 20:00 中山社團 主題」 ----------

export type PostCommand = { date: string; time: string; target: string; topic: string; platform: Platform; format: PostFormat };

/** 解析「發文」後面的文字；格式不對回傳 null。日期沒寫年份：已經過了就當明年 */
export function parsePostCommand(rest: string, today: string): PostCommand | null {
  const m = rest.trim().match(/^(\d{1,2})[/／.-](\d{1,2})\s+(?:(\d{1,2}[:：]\d{2})\s+)?(\S+)(?:\s+([\s\S]+))?$/);
  if (!m) return null;
  const year = +today.slice(0, 4);
  const iso = (y: number) => `${y}-${String(+m[1]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  let date = iso(year);
  if (!isIsoDate(date)) return null;
  if (date < today) date = iso(year + 1);
  const time = m[3] ? parseTime(m[3]) : DEFAULT_TIME;
  if (!time) return null;
  const target = m[4].trim().slice(0, 200);
  const topic = (m[5] ?? "").trim().slice(0, 300);
  if (!topic) return null;
  const platform = guessPlatform(target);
  return { date, time, target, topic, platform, format: guessFormat(target, platform) };
}

// ---------- 提醒 ----------

/** 時間到、還沒提醒過的已排定貼文（由早到晚） */
export function duePosts<T extends Pick<Post, "status" | "due_at" | "notified_at">>(posts: T[], now: number): T[] {
  return posts
    .filter((p) => p.status === "scheduled" && !p.notified_at && Date.parse(p.due_at) <= now)
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
}

/** 延後 1 天：同一個時間的隔天，回到「已排定、還沒提醒」 */
export function postponed(iso: string, days = 1): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram 提醒分兩則：第一則說明發在哪裡，第二則只有文案（長按就能整則複製） */
export function reminderTexts(p: Pick<Post, "platform" | "target" | "due_at" | "topic" | "body"> & { format?: string | null }, projectName: string): { head: string; body: string } {
  const where = p.target ? (isUrl(p.target) ? `<a href="${esc(p.target.trim())}">${esc(p.target.trim())}</a>` : esc(p.target)) : "（沒填）";
  const head = [
    `📣 <b>該發文了</b>｜${esc(projectName)}・${PLATFORM_LABEL[p.platform][0]}${formatOf(p) === "post" ? "" : `・${FORMAT_LABEL[formatOf(p)][0]}`}`,
    `發在：${where}`,
    `預定：${whenText(p.due_at)}${p.topic ? `｜${esc(p.topic)}` : ""}`,
    `ℹ️ ${PLATFORM_NOTE[p.platform][0]}`,
    p.body.trim() ? (formatOf(p) === "post" ? "下一則是完整文案，長按就能複製。" : "下一則是完整腳本，貼文說明在最後面。") : "⚠️ 這則還沒寫文案。",
  ].join("\n");
  return { head, body: esc(p.body.trim()) || "（還沒寫文案）" };
}

// ---------- 畫面 ----------

export type PostDay<T> = { date: string; posts: T[] };

/** 依台北日期分組，由早到晚 */
export function groupByDay<T extends Pick<Post, "due_at">>(posts: T[]): PostDay<T>[] {
  const map = new Map<string, T[]>();
  for (const p of [...posts].sort((a, b) => a.due_at.localeCompare(b.due_at))) {
    const { date } = taipeiParts(p.due_at);
    map.set(date, [...(map.get(date) ?? []), p]);
  }
  return [...map].map(([date, list]) => ({ date, posts: list }));
}

export function postCounts(posts: Pick<Post, "status">[]): Record<PostStatus, number> {
  const out: Record<PostStatus, number> = { draft: 0, scheduled: 0, posted: 0, skipped: 0 };
  for (const p of posts) out[p.status]++;
  return out;
}

/** 清單上的一行標題：有主題用主題，沒有就取文案第一行 */
export function postTitle(p: Pick<Post, "topic" | "body">): string {
  return (p.topic || p.body.split("\n").find((l) => l.trim()) || "").trim().slice(0, 60);
}

// ---------- AI 草稿的規則 ----------

export const PLATFORM_STYLE: Record<Platform, string> = {
  fb_group: "FB 社團貼文：像社團成員自己發的分享文，不像廣告。開頭一句話講清楚這是什麼，3～6 個短段落，必要時第一行加【宣傳】配合版規。結尾一個明確的下一步（連結或怎麼加入）。",
  fb_page: "FB 粉專貼文：自己的官方帳號，口吻可以稍微正式一點但還是口語。150～300 字，結尾一個行動。",
  ig: "IG 貼文說明：前兩行就要讓人想點「更多」，整體 80～200 字，結尾最多 3 個 hashtag。",
  dcard: "Dcard 文章：第一行是標題（不要加「標題：」），空一行後是內文。像學生自己發文的口氣，可以自嘲，不要業配感。",
  line_oa: "LINE 官方帳號動態：很短，60～150 字，一個重點、一個行動。",
};

/** 「語氣像真人、不要 AI 腔」的共同規則 */
export const HUMAN_RULES = [
  "用繁體中文、台灣大學生平常打字的口氣，像本人發的，不像公司小編。",
  "不要用這些 AI 常見寫法：「不只是…更是…」「讓我們一起」「在這個…的時代」「無論你是…還是…」「探索」「打造」「賦能」「旅程」、破折號（——）、連續三個排比句。",
  "不要每一行都放表情符號，整篇最多 3 個；不要用粗體符號、不要 Markdown。",
  "句子長短要有變化，可以有一兩句很短的口語（例如「真的。」「就這樣。」），不要每段都同樣長度。",
  "只寫我給的事實，不要自己編數字、優惠、日期或功能，也不要編我的個人經歷或使用者的故事。",
  "直接輸出貼文內容，不要前言、不要解釋、不要加引號。",
].join("\n");

// ---------- 短影片／輪播／限動的腳本 ----------

/** 腳本裡「貼文說明」那一段的標題：這行以後才是要貼到平台上的文字，文案檢查只看這一段 */
export const CAPTION_MARK = "【貼文說明】";

/** 要貼到平台上的那段文字：一般貼文是整篇；腳本取「貼文說明」之後；限動沒有貼文說明 */
export function captionOf(body: string, format: PostFormat): string {
  if (format === "post") return body;
  const i = body.lastIndexOf(CAPTION_MARK);
  return i < 0 ? "" : body.slice(i + CAPTION_MARK.length).trim();
}

/** 各格式的腳本怎麼寫（給 AI 的規則）。一般貼文沿用 PLATFORM_STYLE */
export const FORMAT_STYLE: Record<Exclude<PostFormat, "post">, string> = {
  reel: [
    "這是一支 20～40 秒短影片的腳本，不是貼文。照下面的段落輸出，段落標題用【】原樣保留：",
    "【開頭三選一】三個不同寫法的第一句話，各一行、編號 1. 2. 3.。每句 15 個字以內、念出來 2 秒內講完，要具體（有數字、有人、有發生的事），不要「你知道嗎」「今天要來分享」這種開場。三句用不同角度：一句講代價或踩過的坑、一句講反直覺的觀點、一句直接講結果。我沒給的經歷、數字、別人說過的話都不要編；沒有素材就用產品本身的事實當開頭。",
    "【口白】照第 1 個開頭接下去的完整口白，像在跟朋友講話，一句一行，每行念得順、不超過 20 個字。",
    "【畫面字卡】3～5 張疊在畫面上的字，每張 10 個字以內，第一張就是開頭那句。",
    "【分鏡】每行一段：「0–2 秒｜畫面｜說什麼」，第一段畫面要有人或有動作，不要靜態字卡開場。",
    `${CAPTION_MARK}影片下面的說明文字：影片已經有開頭了，所以第一行直接講要觀眾做的一件事，再補 2～3 行背景。只能有一個行動（留言某個字、收藏、或私訊，選一個），不放連結，最後一行最多 3 個 hashtag。`,
  ].join("\n"),
  carousel: [
    "這是一組 6～9 張的輪播圖文案，不是貼文。照下面的格式輸出，標題用【】原樣保留：",
    "【第 1 張・封面】主標 12 個字以內（要讓人想往右滑），下面一行副標。",
    "【第 2 張】一句話講為什麼這件事重要。這張要能單獨看懂，不能只是鋪陳。",
    "【第 3 張】到【倒數第 3 張】一張一個重點：標題 4～10 個字，說明不超過 40 個字。需要一段話才講得完就拆成兩張。",
    "【倒數第 2 張・整理】把前面的重點列成清單，這張是讓人截圖收藏的。",
    "【最後一張】一個行動（收藏、留言某個字、或追蹤，選一個）。",
    `${CAPTION_MARK}圖已經把內容講完了，說明文字的第一行是鉤子（跟封面不同的一句話），再 2～4 個短段落補充，結尾重複同一個行動。不放連結，最後一行最多 3 個 hashtag。`,
  ].join("\n"),
  story: [
    "這是一天的限時動態，3～5 格，不是貼文。只有追蹤的人看得到，所以重點是讓人回覆，不是觸及。照下面的格式輸出：",
    "【第 1 格】畫面（要有人臉或手在做事，不要純文字底圖）｜上面的字（15 個字以內）",
    "【第 2 格】【第 3 格】真正的內容：過程、結果或踩到的坑。一格一件事。",
    "【第 4 格】互動貼圖：寫清楚用哪一種（投票／問題箱／小測驗／連結）和上面的題目與選項。行動放這一格，不要放最後。",
    "【第 5 格】收尾：答案、結果，或預告明天。",
    "最後一行寫「回覆後怎麼做：」一句話說明有人回覆或投票後我該怎麼接。不要寫貼文說明、不要 hashtag。",
  ].join("\n"),
};
