import "server-only";
import { callStructured } from "./ai";
import { cleanInvisible } from "./captionCheck";
import { db } from "./db";
import { env } from "./env";
import { sniffImageType } from "./images";
import type { ContentBlock } from "./ai";
import {
  BUCKETS, COMMENT_RULES, COMMENT_TYPES, DM_KINDS, DM_RULES, DM_STYLE, PROFILE_RUBRIC, PROFILE_RULES, REPLY_RULES,
  cleanCommentOut, cleanProfile, cleanProfileInput, cleanReplies, parseComments,
  type CommentOut, type DmKind, type DmOut, type ProfileInput, type ProfileResult, type ReplyOut,
} from "./engageLogic";
import { HUMAN_RULES } from "./postLogic";
import type { Project } from "./projectLogic";

// 互動小幫手與個人檔案健檢：全部只寫草稿給使用者自己貼，不送出、不留言、不登入任何平台。
// 回覆、私訊、留言不存檔；檔案健檢記住每個專案上一次的結果（settings 的 social_profile:<專案 id>）。

type P = Pick<Project, "id" | "name" | "description" | "links">;
const about = (p: P) => [`專案：${p.name}`, `專案的一句話描述：${p.description?.trim() || "（沒有填）"}`].join("\n");
const links = (p: P) => {
  const l = Object.entries(p.links ?? {}).filter(([, u]) => u).map(([k, u]) => `${k}：${u}`);
  return l.length ? `可以提到的連結（只能用這些）：\n${l.join("\n")}` : "沒有可以放的連結，不要自己編網址。";
};
const tidy = (s: string) => cleanInvisible(s.replace(/\*\*(.+?)\*\*/g, "$1")).text.trim();
const VOICE = `口氣：\n${HUMAN_RULES}`;

/** 貼上自己貼文下面的留言 → 分成六類、寫回覆草稿 */
export async function draftReplies(project: P, raw: string, context: string): Promise<{ replies?: ReplyOut[]; error?: string }> {
  const comments = parseComments(raw);
  if (!comments.length) return { error: "先把留言貼進來，一行一則。" };
  const out = await callStructured<{ replies?: unknown }>({
    model: env.researchModel(),
    system: [`你幫一位台灣的創業者回覆他自己貼文下面的留言。他會自己看過、自己貼上去。`, REPLY_RULES, VOICE].join("\n\n"),
    content: [about(project), links(project), context.trim() ? `關於這則貼文（在講什麼、請大家留的字、回覆時可以用的事實）：\n${context.trim().slice(0, 1500)}` : "", `留言（照編號回）：\n${comments.map((c) => `${c.n}. ${c.who ? `${c.who}：` : ""}${c.text}`).join("\n")}`].filter(Boolean).join("\n\n"),
    toolName: "comment_replies",
    toolDescription: "回報每則留言的分類與回覆草稿",
    schema: {
      type: "object",
      properties: {
        replies: {
          type: "array",
          items: {
            type: "object",
            properties: { n: { type: "integer", description: "留言的編號" }, bucket: { type: "string", enum: [...BUCKETS] }, reply: { type: "string", description: "回覆草稿；noise 留空字串" }, reel: { type: "boolean", description: "這個問題值得拍成一支短影片" } },
            required: ["n", "bucket", "reply", "reel"],
          },
        },
      },
      required: ["replies"],
    },
    maxTokens: 3500,
    purpose: "social_reply",
  });
  return { replies: cleanReplies(out, comments).map((r) => ({ ...r, reply: tidy(r.reply) })) };
}

export type DmInput = { kind: DmKind; who: string; trigger: string; want: string; give: string };

/** 寫一則私訊＋兩則追蹤訊息。沒有「今天為什麼要傳」的理由就不寫 */
export async function draftDm(project: P, v: DmInput): Promise<{ dm?: DmOut; error?: string }> {
  if (!DM_KINDS.includes(v.kind)) return { error: "類型不對" };
  const trigger = v.trigger.trim().slice(0, 600);
  if (trigger.length < 4) return { error: "要寫「今天為什麼傳給他」：他留了什麼言、回了哪則限動、發了什麼。沒有理由的私訊就是打擾，先去他的貼文互動一陣子。" };
  const out = await callStructured<Record<string, unknown>>({
    model: env.researchModel(),
    system: [`你幫一位台灣的創業者寫一則 IG 私訊，他會自己看過、自己傳。`, DM_STYLE[v.kind], DM_RULES, VOICE].join("\n\n"),
    content: [about(project), links(project), `對方是誰：${v.who.trim().slice(0, 300) || "（沒有填）"}`, `今天為什麼傳給他：${trigger}`, v.give.trim() ? `我要給他的東西：${v.give.trim().slice(0, 400)}` : "", v.want.trim() ? `我希望的結果（不一定要寫進訊息）：${v.want.trim().slice(0, 300)}` : ""].filter(Boolean).join("\n\n"),
    toolName: "dm_draft",
    toolDescription: "回報私訊與兩則追蹤訊息",
    schema: {
      type: "object",
      properties: { message: { type: "string", description: "第一則訊息" }, follow4: { type: "string", description: "第 4 天的追蹤訊息，要帶新的東西" }, follow10: { type: "string", description: "第 10 天的最後一則，說清楚之後不會再打擾" } },
      required: ["message", "follow4", "follow10"],
    },
    maxTokens: 1200,
    purpose: "social_dm",
  });
  const dm: DmOut = { message: tidy(String(out?.message ?? "")).slice(0, 1000), follow4: tidy(String(out?.follow4 ?? "")).slice(0, 600), follow10: tidy(String(out?.follow10 ?? "")).slice(0, 600) };
  return dm.message ? { dm } : { error: "AI 沒有寫出內容，再按一次試試。" };
}

/** 貼上別人的貼文 → 兩則不同類型的留言 */
export async function draftComments(project: P, v: { account: string; post: string; mine: string }): Promise<{ comment?: CommentOut; error?: string }> {
  const post = v.post.trim().slice(0, 3000);
  if (post.length < 10) return { error: "先把對方貼文的文字貼進來（影片就貼他講的內容或說明文字）。" };
  const out = await callStructured<Record<string, unknown>>({
    model: env.researchModel(),
    system: [`你幫一位台灣的創業者去別人的貼文下面留言，目的是讓對方和看留言的人記得他，不是推銷。他會自己看過、自己貼。`, COMMENT_RULES, VOICE].join("\n\n"),
    content: [about(project), v.account.trim() ? `對方帳號：${v.account.trim().slice(0, 60)}` : "", `對方的貼文：\n${post}`, v.mine.trim() ? `我自己相關的經驗或數字（可以用）：${v.mine.trim().slice(0, 500)}` : "我沒有提供自己的經驗或數字，不要選「我做過」「補一個數字」這兩類。"].filter(Boolean).join("\n\n"),
    toolName: "comment_options",
    toolDescription: "回報兩則留言與建議",
    schema: {
      type: "object",
      properties: {
        options: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: COMMENT_TYPES.map((t) => t[0]) }, text: { type: "string" } }, required: ["type", "text"] } },
        pick: { type: "string", description: "一句話：會選哪一則、為什麼" },
      },
      required: ["options", "pick"],
    },
    maxTokens: 900,
    purpose: "social_comment",
  });
  const comment = cleanCommentOut(out);
  comment.options = comment.options.map((o) => ({ ...o, text: tidy(o.text) }));
  return comment.options.length ? { comment } : { error: "AI 沒有寫出內容，再按一次試試。" };
}

const profileKey = (projectId: string) => `social_profile:${projectId}`;

export async function lastProfile(projectId: string): Promise<ProfileResult | null> {
  const { data } = await db().from("settings").select("value").eq("key", profileKey(projectId)).maybeSingle();
  try {
    const v = JSON.parse((data as { value?: string } | null)?.value ?? "null") as ProfileResult | null;
    return v && Array.isArray(v.items) ? v : null;
  } catch {
    return null;
  }
}

/** 個人檔案健檢：自己填的欄位，或一張個人檔案的截圖（兩個都給更準）。結果存起來，下次打開還在 */
export async function checkProfile(project: P, fields: unknown, image?: string | null): Promise<{ result?: ProfileResult; error?: string }> {
  const input = cleanProfileInput(fields);
  const content: ContentBlock[] = [];
  if (image) {
    const m = image.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
    if (!m || m[1].length > 2_800_000) return { error: "圖片太大或格式不對" };
    const mediaType = sniffImageType(new Uint8Array(Buffer.from(m[1], "base64")));
    if (!mediaType) return { error: "只接受 JPG、PNG、WebP、GIF 圖片" };
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: m[1] } });
  }
  if (!image && Object.keys(input).length < 2) return { error: "至少填名稱欄和簡介，或貼一張個人檔案的截圖。" };
  const filled = Object.entries(input).map(([k, v]) => `${k}：${v}`).join("\n");
  content.push({ type: "text", text: [about(project), image ? "上面是個人檔案的截圖。" : "", filled ? `我自己填的：\n${filled}` : "", "請照規則評 12 項。"].filter(Boolean).join("\n\n") });
  const raw = await callStructured<{ items?: unknown }>({
    model: env.researchModel(),
    system: `你幫一位台灣的創業者健檢社群帳號的個人檔案。\n\n${PROFILE_RULES}`,
    content,
    toolName: "profile_score",
    toolDescription: "回報 12 項的評分與改法",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string", enum: PROFILE_RUBRIC.map((r) => r.id) }, score: { type: "integer" }, note: { type: "string" }, fix: { type: "string", description: "拿滿分就留空字串" } }, required: ["id", "score", "note", "fix"] },
        },
      },
      required: ["items"],
    },
    maxTokens: 2500,
    purpose: "social_profile",
  });
  const result = cleanProfile(raw, input, new Date().toISOString());
  result.items = result.items.map((i) => ({ ...i, note: tidy(i.note), fix: tidy(i.fix) }));
  await db().from("settings").upsert({ key: profileKey(project.id), value: JSON.stringify(result), updated_at: new Date().toISOString() });
  return { result };
}
