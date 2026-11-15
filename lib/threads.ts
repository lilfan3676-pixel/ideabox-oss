// Threads 連結解析與貼文內容讀取。前半部是純函式（有單元測試）。

const THREADS_HOSTS = new Set(["threads.net", "www.threads.net", "threads.com", "www.threads.com"]);

export type ParsedLink = {
  canonical: string; // 統一後的網址
  key: string; // 去重鍵
  isThreads: boolean;
  isPost: boolean;
  author: string | null;
  /** GitHub 專案（owner/repo），不是 GitHub 連結則為 undefined */
  githubRepo?: string;
};

// github.com 底下不是專案的路徑
const GITHUB_RESERVED = new Set([
  "features", "topics", "collections", "explore", "marketplace", "orgs", "settings", "sponsors",
  "trending", "login", "signup", "about", "pricing", "enterprise", "search", "notifications", "pulls", "issues",
]);

/** 去掉追蹤參數（utm_*、igsh、fbclid 等），保留其他參數並排序 */
function cleanQuery(u: URL): string {
  const keep = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|igsh|igshid|fbclid|gclid|ref|ref_src|si|psln|srtk|xmt|slof|mibextid)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  return keep.length ? `?${new URLSearchParams(keep).toString()}` : "";
}

const URL_RE = /https?:\/\/[^\s<>"'）】」]+/gi;

/** 從一段文字（加上 Telegram entities 給的網址）抓出所有網址，去除重複。 */
export function extractUrls(text: string, extra: string[] = []): string[] {
  const found = [...(text.match(URL_RE) ?? []), ...extra];
  const out: string[] = [];
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:!?。，、！？)\]]+$/u, "");
    if (!out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

/** 把文字中的網址移除，剩下的當成使用者自己的補充說明。 */
export function stripUrls(text: string): string {
  return text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
}

export function parseLink(raw: string): ParsedLink | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (THREADS_HOSTS.has(host)) {
    const m = u.pathname.match(/^\/(@[A-Za-z0-9._]+)\/post\/([A-Za-z0-9_-]+)/);
    if (m) {
      return {
        canonical: `https://www.threads.com/${m[1]}/post/${m[2]}`,
        key: `threads:${m[2]}`,
        isThreads: true,
        isPost: true,
        author: m[1],
      };
    }
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return {
      canonical: `https://www.threads.com${path}`,
      key: `threads:${path.toLowerCase()}`,
      isThreads: true,
      isPost: false,
      author: path.startsWith("/@") ? path.slice(1).split("/")[0] : null,
    };
  }
  // GitHub 專案
  if (host === "github.com" || host === "www.github.com") {
    const m = u.pathname.match(/^\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/);
    if (m && !GITHUB_RESERVED.has(m[1].toLowerCase())) {
      const repo = `${m[1]}/${m[2].replace(/\.git$/, "")}`;
      return {
        canonical: `https://github.com/${repo}`,
        key: `github:${repo.toLowerCase()}`,
        isThreads: false,
        isPost: false,
        author: m[1],
        githubRepo: repo,
      };
    }
  }
  // Instagram：貼文／Reel 只看路徑
  if (host === "instagram.com" || host === "www.instagram.com") {
    const m = u.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (m) {
      const kind = m[1] === "reels" ? "reel" : m[1];
      return {
        canonical: `https://www.instagram.com/${kind}/${m[2]}/`,
        key: `instagram:${m[2]}`,
        isThreads: false,
        isPost: true,
        author: null,
      };
    }
  }
  // 其他網站：去掉追蹤參數後去重
  const path = u.pathname.replace(/\/+$/, "");
  const q = cleanQuery(u);
  const canonical = `${u.protocol}//${host}${path}${q}`;
  return { canonical, key: `link:${host.replace(/^www\./, "")}${path}${q}`.toLowerCase(), isThreads: false, isPost: false, author: null };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function getMeta(html: string, prop: string): string | null {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 逐一檢查每個 <meta> 標籤，content 的引號用反向參照配對，內文含 ' 或 " 也不會截斷
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const keyRe = new RegExp(`(?:property|name)\\s*=\\s*(["'])${esc}\\1`, "i");
  for (const tag of tags) {
    if (!keyRe.test(tag)) continue;
    const m = tag.match(/content\s*=\s*(["'])([\s\S]*?)\1/i);
    if (m) return decodeEntities(m[2]).trim();
  }
  return null;
}

// Threads 在未登入或被擋時會回傳的通用描述，這種不算讀到內容
const GENERIC_PATTERNS = [
  /join threads/i,
  /log in (with|to)/i,
  /say more with threads/i,
  /instagram's text app/i,
  /加入 threads/i,
  /登入/,
];

export function isUsefulText(text: string | null | undefined): text is string {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 4) return false;
  return !GENERIC_PATTERNS.some((re) => re.test(t));
}

export type FetchedPost = { content: string | null; author: string | null; imageUrl: string | null };

/** 依序嘗試：公開頁面的分享摘要 → Threads 官方嵌入介面（有設定 token 才用）。都失敗回傳 null。 */
export async function fetchPostContent(link: ParsedLink, threadsToken = ""): Promise<FetchedPost | null> {
  const fromPage = await tryOpenGraph(link.canonical);
  let content = fromPage?.content ?? null;
  if (!content && link.isThreads && link.isPost && threadsToken) {
    content = await tryOembed(link.canonical, threadsToken);
  }
  if (!content && !fromPage?.imageUrl) return null;
  return { content, author: fromPage?.author ?? link.author, imageUrl: fromPage?.imageUrl ?? null };
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export type OpenGraph = { content: string | null; author: string | null; imageUrl: string | null; title: string | null };

/** 解析分享預覽資訊。內容是登入牆的通用文字時 content 為 null，但仍保留圖片。 */
export function parseOpenGraph(html: string): OpenGraph | null {
  const desc = getMeta(html, "og:description") ?? getMeta(html, "description");
  const title = getMeta(html, "og:title");
  const image = getMeta(html, "og:image") ?? getMeta(html, "twitter:image");
  const m = title?.match(/\((@[A-Za-z0-9._]+)\)/);
  const content = isUsefulText(desc) ? desc : null;
  const imageUrl = image && /^https?:\/\//.test(image) ? image : null;
  if (!content && !imageUrl) return null;
  return { content, author: m ? m[1] : null, imageUrl, title: title || null };
}

async function tryOpenGraph(url: string) {
  const res = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    },
  });
  if (!res || !res.ok) return null;
  const html = (await res.text()).slice(0, 400_000);
  return parseOpenGraph(html);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

async function tryOembed(url: string, token: string): Promise<string | null> {
  const api = `https://graph.threads.net/v1.0/oembed?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetchWithTimeout(api, {});
  if (!res || !res.ok) return null;
  const json = (await res.json().catch(() => null)) as { html?: string } | null;
  const text = json?.html ? htmlToText(json.html) : "";
  return isUsefulText(text) ? text : null;
}
