import "server-only";
import { callClaude, noThinking, textOf } from "./ai";
import { db } from "./db";
import { env } from "./env";
import { removeImage, signedUrls } from "./images";
import { cleanInvisible } from "./captionCheck";
import { FORMAT_LABEL, FORMAT_STYLE, HUMAN_RULES, MAX_BODY, PLATFORM_LABEL, PLATFORM_STYLE, dueIso, duePosts, formatsFor, isFormat, isKind, isPlatform, KIND_STYLE, isPostStatus, postponed, reminderTexts, whenText, type Platform, type Post, type PostCommand, type PostFormat, type PostKind, type PostStatus } from "./postLogic";
import type { Project } from "./projectLogic";
import { swipesForPrompt, type Swipe } from "./swipeLogic";
import { esc, sendPhoto, sendToOwner, sendToOwnerWithButtons } from "./telegram";

// 發文排程器：每個專案的社群貼文。時間到用 Telegram 把文案傳給主人，自己貼上去
// （FB 社團不開放程式發文；粉專、IG 之後可以接 Meta API）。資料表 project_posts（migration-028）。

export const POSTS_MIGRATION = "migration-028-posts.sql";
/** 短影片／輪播／限動的格式欄位 */
export const FORMAT_MIGRATION = "migration-030-social.sql";
/** 內容類型與靈感庫 */
export const PLAN_MIGRATION = "migration-031-social-plan.sql";

/** ready=false 代表還沒執行 migration-028 */
export async function listPosts(projectId?: string): Promise<{ posts: Post[]; ready: boolean }> {
  let q = db().from("project_posts").select("*");
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q.order("due_at", { ascending: true }).limit(1000);
  if (error) return { posts: [], ready: false };
  return { posts: (data ?? []) as Post[], ready: true };
}

export async function getPost(id: string): Promise<Post | null> {
  const { data } = await db().from("project_posts").select("*").eq("id", id).maybeSingle();
  return (data as Post | null) ?? null;
}

export type PostInput = { platform: Platform; format?: PostFormat; kind?: PostKind | null; target: string; date: string; time: string; topic: string; body: string; status: PostStatus; imagePath?: string | null };

function rowOf(v: PostInput): { row: Record<string, unknown>; format: PostFormat; kind: PostKind | null | undefined } | { error: string } {
  if (!isPlatform(v.platform)) return { error: "平台不對" };
  const due = dueIso(v.date, v.time);
  if (!due) return { error: "預定時間不對，請填日期和時間" };
  const status = isPostStatus(v.status) ? v.status : "draft";
  // 看不見的字元（從別處貼上時混進來的）存檔時順手清掉
  const body = cleanInvisible(String(v.body ?? "")).text.trim().slice(0, MAX_BODY);
  // 這個平台沒有的格式（例如 FB 社團的限動）當作一般貼文
  const format: PostFormat = isFormat(v.format) && formatsFor(v.platform).includes(v.format) ? v.format : "post";
  const topic = String(v.topic ?? "").trim().slice(0, 300);
  if (!body && !topic) return { error: "主題或文案至少要填一個" };
  return { row: { platform: v.platform, target: String(v.target ?? "").trim().slice(0, 300), due_at: due, topic, body, status }, format, kind: v.kind === undefined ? undefined : isKind(v.kind) ? v.kind : null };
}

const needs030 = (format: PostFormat) => `${FORMAT_LABEL[format][0]}需要先在 ideabox 的 Supabase 執行 ${FORMAT_MIGRATION}`;

export async function createPost(projectId: string, v: PostInput, source: Post["source"] = "manual"): Promise<{ post?: Post; error?: string }> {
  const r = rowOf(v);
  if ("error" in r) return { error: r.error };
  // 一般貼文不帶 format 欄位：還沒執行 migration-030 時原本的排程照常能用
  const extra: Record<string, unknown> = r.format === "post" ? {} : { format: r.format };
  if (r.kind) extra.kind = r.kind; // 沒選類型就不帶，還沒執行 migration-031 也能存
  const { data, error } = await db().from("project_posts").insert({ ...r.row, ...extra, project_id: projectId, source, image_path: v.imagePath ?? null }).select().single();
  if (error) return { error: r.kind ? `內容類型需要先在 ideabox 的 Supabase 執行 ${PLAN_MIGRATION}` : r.format === "post" ? `存不進去：請先在 ideabox 的 Supabase 執行 ${POSTS_MIGRATION}` : needs030(r.format) };
  return { post: data as Post };
}

/** 改內容；時間或狀態改了就重新等提醒 */
export async function updatePost(post: Post, v: PostInput): Promise<{ post?: Post; error?: string }> {
  const r = rowOf(v);
  if ("error" in r) return { error: r.error };
  const patch: Record<string, unknown> = { ...r.row, updated_at: new Date().toISOString() };
  if (r.format !== (isFormat(post.format) ? post.format : "post")) patch.format = r.format;
  if (r.kind !== undefined && r.kind !== (post.kind ?? null)) patch.kind = r.kind;
  if (r.row.due_at !== post.due_at || (r.row.status === "scheduled" && post.status !== "scheduled")) patch.notified_at = null;
  if (r.row.status === "posted" && post.status !== "posted") patch.posted_at = new Date().toISOString();
  if (v.imagePath !== undefined && v.imagePath !== post.image_path) {
    patch.image_path = v.imagePath;
    await removeImage(post.image_path);
  }
  const { data, error } = await db().from("project_posts").update(patch).eq("id", post.id).select().single();
  if (error) return { error: "kind" in patch ? `內容類型需要先在 ideabox 的 Supabase 執行 ${PLAN_MIGRATION}` : "format" in patch ? needs030(r.format) : error.message };
  return { post: data as Post };
}

export async function setPostStatus(post: Post, status: PostStatus): Promise<void> {
  const now = new Date().toISOString();
  await db()
    .from("project_posts")
    .update({ status, updated_at: now, posted_at: status === "posted" ? now : null, ...(status === "scheduled" && post.status !== "scheduled" ? { notified_at: null } : {}) })
    .eq("id", post.id);
}

/** 延後 1 天：時間到會再提醒一次 */
export async function postponePost(post: Post): Promise<string> {
  const due = postponed(post.due_at);
  // 草稿延後還是草稿（不提醒）；其他的回到已排定
  await db().from("project_posts").update({ due_at: due, status: post.status === "draft" ? "draft" : "scheduled", notified_at: null, posted_at: null, updated_at: new Date().toISOString() }).eq("id", post.id);
  return due;
}

export async function deletePost(post: Post): Promise<void> {
  await db().from("project_posts").delete().eq("id", post.id);
  await removeImage(post.image_path);
}

// ---------- AI 寫草稿 ----------

export function draftEnabled(): boolean {
  try {
    return Boolean(env.anthropicKey());
  } catch {
    return false;
  }
}

/** 依專案的一句話描述與主題寫一篇草稿；拿這個專案之前的貼文當語氣參考 */
export async function draftPost(project: Pick<Project, "id" | "name" | "description" | "links">, v: { platform: Platform; format?: PostFormat; kind?: PostKind | null; target: string; topic: string }): Promise<string> {
  const { data } = await db().from("project_posts").select("*").eq("project_id", project.id).order("due_at", { ascending: false }).limit(30);
  const format: PostFormat = isFormat(v.format) && formatsFor(v.platform).includes(v.format) ? v.format : "post";
  // 語氣參考只拿一般貼文（腳本的格式不一樣，拿來參考會把格式帶歪）
  const samples = ((data ?? []) as Post[])
    .filter((p) => p.body.trim().length > 60 && (p.format ?? "post") === "post")
    .sort((a, b) => Number(b.platform === v.platform) - Number(a.platform === v.platform))
    .slice(0, 2);
  // 靈感庫裡最近有效的開頭（沒有這張表就略過）
  const { data: swipeRows } = await db().from("social_swipes").select("*").eq("project_id", project.id).limit(200);
  const hooks = swipesForPrompt((swipeRows ?? []) as Swipe[]);
  const links = Object.entries(project.links ?? {}).filter(([, url]) => url).map(([k, url]) => `${k}：${url}`);
  const model = env.researchModel();
  const system = `你幫一位台灣的創業者寫社群貼文草稿，他會自己再改、自己貼出去。\n\n${HUMAN_RULES}\n\n這次的格式：${format === "post" ? PLATFORM_STYLE[v.platform] : FORMAT_STYLE[format]}`;
  const content = [
    `專案：${project.name}`,
    `專案的一句話描述：${project.description?.trim() || "（沒有填）"}`,
    links.length ? `可以放的連結（只能用這些，沒有就不要放連結）：\n${links.join("\n")}` : "沒有可以放的連結，不要自己編網址。",
    `平台：${PLATFORM_LABEL[v.platform][0]}${format === "post" ? "" : `（${FORMAT_LABEL[format][0]}）`}`,
    v.target ? `發在：${v.target}` : "",
    `這篇的主題：${v.topic}`,
    isKind(v.kind) ? `這篇的類型：${KIND_STYLE[v.kind]}` : "",
    hooks ? `同領域最近有效的開頭（只學句子的形狀，不要抄內容、不要提到這些帳號）：\n${hooks}` : "",
    samples.length ? `我之前自己寫的貼文（只參考語氣和長度，不要照抄內容）：\n${samples.map((s, i) => `--- 第 ${i + 1} 篇 ---\n${s.body.slice(0, 900)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const res = await callClaude({ model, max_tokens: format === "post" ? 1500 : 2500, system, messages: [{ role: "user", content }], ...noThinking(model) }, 90_000, "post_draft");
  return cleanDraft(textOf(res)).slice(0, MAX_BODY);
}

/** 拿掉模型偶爾會加的引號、Markdown 粗體與「以下是…」開場 */
export function cleanDraft(s: string): string {
  return s
    .replace(/^(以下是|這是|好的)[^\n]{0,30}[：:]\s*\n+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^["「『]([\s\S]+)["」』]$/, "$1")
    .trim();
}

// ---------- Telegram：新增、提醒、按鈕 ----------

/** 「<短名> 發文 11/21 20:00 中山社團 主題」：寫好草稿、排進去，回傳要回覆的訊息 */
export async function addPostFromTelegram(project: Project, cmd: PostCommand): Promise<string> {
  let body = "";
  let note = "";
  if (draftEnabled()) {
    body = await draftPost(project, cmd).catch(() => "");
    if (!body) note = "\n⚠️ AI 草稿沒寫成功，先只存主題，到專案頁再按一次「AI 寫草稿」。";
  } else {
    note = "\nℹ️ 沒設定 ANTHROPIC_API_KEY，所以沒有 AI 草稿，先只存主題。";
  }
  const r = await createPost(project.id, { ...cmd, body, status: "scheduled" }, "telegram");
  if (!r.post) return `⚠️ ${esc(r.error ?? "存不進去")}`;
  const app = env.appUrl();
  const link = app ? `\n\n修改：${app.replace(/\/+$/, "")}/social?p=${project.slug}&view=posts` : "";
  const when = whenText(r.post.due_at);
  return `📣 ${esc(project.name)} 已排定發文：${when}・${PLATFORM_LABEL[cmd.platform][0]}${cmd.format === "post" ? "" : `・${FORMAT_LABEL[cmd.format][0]}`}・${esc(cmd.target)}\n主題：${esc(cmd.topic)}${note}${body ? `\n\n<b>AI 草稿</b>（時間到會把完整文案傳給你）：\n${esc(body)}` : ""}${link}`;
}

const buttonsFor = (id: string) => [[{ text: "✅ 已發", data: `po:p:${id}` }, { text: "⏰ 延後 1 天", data: `po:d:${id}` }, { text: "🚫 略過", data: `po:s:${id}` }]];

/** 每 5 分鐘：時間到的貼文，把發在哪裡與完整文案傳給主人（一次最多 5 則，其他下一輪） */
export async function runPostReminders(now = Date.now()): Promise<number> {
  if (!env.telegramOwnerId()) return 0;
  const { data, error } = await db().from("project_posts").select("*").eq("status", "scheduled").lte("due_at", new Date(now).toISOString()).limit(200);
  if (error || !data?.length) return 0;
  const due = duePosts(data as Post[], now).slice(0, 5);
  if (!due.length) return 0;
  const { data: projects } = await db().from("projects").select("id, name");
  const names = new Map(((projects ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  let sent = 0;
  for (const p of due) {
    // 先標記再傳，避免同一則每 5 分鐘重複提醒；整則都沒傳出去才改回來
    await db().from("project_posts").update({ notified_at: new Date(now).toISOString() }).eq("id", p.id);
    const t = reminderTexts(p, names.get(p.project_id) ?? "");
    const headId = await sendToOwner(t.head);
    if (p.image_path) {
      const url = (await signedUrls([p.image_path], 3600))[p.image_path];
      if (url) await sendPhoto(env.telegramOwnerId(), url);
    }
    const bodyId = await sendToOwnerWithButtons(t.body, buttonsFor(p.id));
    if (!headId && !bodyId) {
      await db().from("project_posts").update({ notified_at: null }).eq("id", p.id);
      continue;
    }
    sent++;
  }
  return sent;
}

/** 提醒訊息上的按鈕：已發／延後 1 天／略過。回傳按鈕的回應文字，done=true 時把按鈕收起來 */
export async function handlePostButton(data: string): Promise<{ toast: string; done: boolean; text?: string }> {
  const [, action, id] = data.split(":");
  const post = id ? await getPost(id) : null;
  if (!post) return { toast: "這則貼文已經不在排程裡了", done: true };
  if (action === "p") {
    await setPostStatus(post, "posted");
    return { toast: "標成已發", done: true, text: "✅ 已標成「已發」" };
  }
  if (action === "s") {
    await setPostStatus(post, "skipped");
    return { toast: "這則略過", done: true, text: "🚫 這則略過，不會再提醒" };
  }
  if (action === "d") {
    const due = await postponePost(post);
    return { toast: "延後 1 天", done: true, text: `⏰ 延後到 ${whenText(due)}，到時候再提醒你` };
  }
  return { toast: "", done: false };
}
