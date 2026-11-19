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

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

// ---------- Telegram 指令：「<短名> 發文 11/21 20:00 中山社團 主題」 ----------

export type PostCommand = { date: string; time: string; target: string; topic: string; platform: Platform };

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
  return { date, time, target, topic, platform: guessPlatform(target) };
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
export function reminderTexts(p: Pick<Post, "platform" | "target" | "due_at" | "topic" | "body">, projectName: string): { head: string; body: string } {
  const where = p.target ? (isUrl(p.target) ? `<a href="${esc(p.target.trim())}">${esc(p.target.trim())}</a>` : esc(p.target)) : "（沒填）";
  const head = [
    `📣 <b>該發文了</b>｜${esc(projectName)}・${PLATFORM_LABEL[p.platform][0]}`,
    `發在：${where}`,
    `預定：${whenText(p.due_at)}${p.topic ? `｜${esc(p.topic)}` : ""}`,
    `ℹ️ ${PLATFORM_NOTE[p.platform][0]}`,
    p.body.trim() ? "下一則是完整文案，長按就能複製。" : "⚠️ 這則還沒寫文案。",
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
