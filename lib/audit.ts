import "server-only";
import { callClaude, callStructured, noThinking, textOf } from "./ai";
import { auditForPrompt, auditOf, cleanMetrics, findings, METRIC_KEYS, type Metrics } from "./auditLogic";
import { db } from "./db";
import { env } from "./env";
import { sniffImageType } from "./images";
import type { Post } from "./postLogic";
import type { Project } from "./projectLogic";

// 成效檢討：已發貼文的數字（自己填，或貼洞察報告截圖讓 AI 讀）。IG 不開放自動抓這些數字。
// 欄位 project_posts.metrics（migration-032）。

export const METRICS_MIGRATION = "migration-032-social-metrics.sql";

export async function saveMetrics(post: Post, input: unknown): Promise<{ ok: boolean; error?: string }> {
  const m = cleanMetrics(input);
  const empty = Object.keys(m).length === 0;
  const { error } = await db().from("project_posts").update({ metrics: empty ? null : m, metrics_at: empty ? null : new Date().toISOString() }).eq("id", post.id);
  return error ? { ok: false, error: `成效數字需要先在 ideabox 的 Supabase 執行 ${METRICS_MIGRATION}` } : { ok: true };
}

const SCHEMA = {
  type: "object",
  properties: {
    ...Object.fromEntries(METRIC_KEYS.filter((k) => k !== "nonfollower").map((k) => [k, { type: ["number", "null"], description: "畫面上沒有就填 null，不要猜" }])),
    nonfollower: { type: ["number", "null"], description: "非追蹤者佔觸及或觀看的百分比（0～100）；畫面上沒有就填 null" },
  },
  required: [...METRIC_KEYS],
};

/** 讀一張洞察報告截圖上的數字（不存檔，回傳給表單讓使用者核對）。讀不到的欄位留空 */
export async function readMetricsImage(dataUrl: string): Promise<{ metrics?: Metrics; error?: string }> {
  const m = dataUrl.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > 2_800_000) return { error: "圖片太大或格式不對" };
  const mediaType = sniffImageType(new Uint8Array(Buffer.from(m[1], "base64")));
  if (!mediaType) return { error: "只接受 JPG、PNG、WebP、GIF 圖片" };
  const raw = await callStructured<Record<string, unknown>>({
    model: env.analyzeModel(),
    system: "這是一張社群平台（IG、FB、Threads 等）單則貼文的洞察報告截圖。把畫面上看得到的數字抄下來：views＝觀看或播放次數、reach＝觸及的帳號數、likes＝讚、comments＝留言、shares＝分享或傳送、saves＝收藏或儲存、follows＝這則帶來的追蹤、nonfollower＝非追蹤者的百分比。「1.2萬」「12.3K」要換成完整數字。畫面上沒有的一律填 null，不要推算、不要猜。",
    content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: m[1] } }, { type: "text", text: "請讀出這張截圖上的數字。" }],
    toolName: "post_metrics",
    toolDescription: "回報截圖上讀到的數字",
    schema: SCHEMA,
    maxTokens: 400,
    purpose: "social_metrics",
  });
  const metrics = cleanMetrics(raw);
  return Object.keys(metrics).length ? { metrics } : { error: "這張圖上沒讀到數字，換一張洞察報告的截圖，或自己填。" };
}

/** 請 AI 解讀成效：該多做什麼、該停什麼。只能用表上的數字，樣本少要講明白 */
export async function auditAdvice(project: Pick<Project, "name" | "description">, posts: Post[]): Promise<{ text?: string; error?: string }> {
  const a = auditOf(posts);
  const table = auditForPrompt(a);
  if (!table) return { error: "有觀看數的貼文不到 3 則，還看不出什麼。先多填幾則已發貼文的數字。" };
  const mine = findings(a).map((f) => `・${f.text[0]}`).join("\n");
  const model = env.researchModel();
  const system = [
    "你幫一位台灣的創業者檢討社群貼文的成效。他要的是能照著做的結論，不是安慰。",
    "規則：",
    "・只能用我給的數字，不要編、不要引用外面的「業界平均」。",
    "・看「是他平常的幾倍」和「每千次觸及的分享」，不要看觀看數的大小。",
    "・先分清楚：觀看高但沒人追蹤＝個人檔案的問題；沒人看＝開頭的問題。",
    "・樣本少於 10 則要直接說「還不穩」，每個結論後面括號寫是幾則得出來的。",
    "・輸出三段，每段 1～3 行，用繁體中文、白話、不用 Markdown 符號：「多做：」「停掉：」「下一則試試：」（最後一段給一個具體的主題角度）。",
  ].join("\n");
  const content = [`專案：${project.name}`, `專案的一句話描述：${project.description?.trim() || "（沒有填）"}`, table, mine ? `程式已經看出來的：\n${mine}` : ""].filter(Boolean).join("\n\n");
  const res = await callClaude({ model, max_tokens: 700, system, messages: [{ role: "user", content }], ...noThinking(model) }, 60_000, "social_audit");
  const text = textOf(res).replace(/\*\*(.+?)\*\*/g, "$1").trim();
  return text ? { text: text.slice(0, 1500) } : { error: "AI 沒有回內容，再按一次試試。" };
}
