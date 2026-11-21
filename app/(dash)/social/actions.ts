"use server";

import { revalidatePath } from "next/cache";
import { requireProjectEdit } from "@/lib/auth";
import { getL } from "@/lib/i18nServer";
import { sniffImageType, storeImage } from "@/lib/images";
import { taipeiDate } from "@/lib/dates";
import { isFormat, isKind, isPlatform, isPostStatus, weekStart, type PostFormat, type PostStatus } from "@/lib/postLogic";
import { cleanPlan, planWeek, type PlanSlot } from "@/lib/socialPlan";
import { addSwipe, deleteSwipe, getSwipe } from "@/lib/swipes";
import type { SwipeInput } from "@/lib/swipeLogic";
import { auditAdvice, readMetricsImage, saveMetrics } from "@/lib/audit";
import { checkProfile, draftComments, draftDm, draftReplies, type DmInput } from "@/lib/engage";
import type { CommentOut, DmOut, ProfileResult, ReplyOut } from "@/lib/engageLogic";
import type { Metrics } from "@/lib/auditLogic";
import { createPost, deletePost, draftEnabled, draftPost, getPost, imageToken, listPosts, postponePost, resolveImages, setPostStatus, updatePost, type PostInput } from "@/lib/posts";
import { getProject } from "@/lib/projects";

// 社群助手（發文排程）的動作：主人，或這個專案「可編輯」的合夥人才能用（requireProjectEdit）

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
export type PostResult = { ok: boolean; error?: string; draft?: string; slots?: PlanSlot[]; saved?: number; metrics?: Metrics };
const done = (): PostResult => {
  revalidatePath("/social");
  revalidatePath("/projects"); // 月曆上的 📣
  return { ok: true };
};

/** 瀏覽器先把圖片縮小成 JPEG 再傳上來（data URL）；存到 Storage 回傳路徑 */
async function saveImage(dataUrl: string | null | undefined): Promise<string | null | undefined> {
  if (dataUrl === undefined) return undefined; // 沒動圖片
  if (dataUrl === null || dataUrl === "") return null; // 拿掉圖片
  const m = dataUrl.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length > 2_800_000) throw new Error("圖片太大或格式不對");
  const mediaType = sniffImageType(new Uint8Array(Buffer.from(m[1], "base64")));
  if (!mediaType) throw new Error("只接受 JPG、PNG、WebP、GIF 圖片");
  const path = await storeImage({ mediaType, base64: m[1] });
  if (!path) throw new Error("圖片存不進去");
  return path;
}

/** 先把一張圖片傳上來（一次一張，避免一次送太大）；回傳的簽章在存檔時放進圖片清單 */
export async function uploadPostImageAction(projectId: string, dataUrl: string): Promise<PostResult & { token?: string }> {
  await requireProjectEdit(projectId);
  const L = await getL();
  if (!isUuid(projectId) || !(await getProject(projectId))) return { ok: false };
  try {
    const path = await saveImage(dataUrl);
    if (!path) return { ok: false, error: L("圖片存不進去", "Couldn't save the image") };
    return { ok: true, token: imageToken(path) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : L("圖片存不進去", "Couldn't save the image") };
  }
}

/** images：全部圖片照順序（已經在這則貼文上的路徑，或 uploadPostImageAction 回傳的簽章）；不給＝不動圖片 */
export async function savePostAction(projectId: string, postId: string | null, v: Omit<PostInput, "images"> & { images?: string[] }): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  if (!isUuid(projectId) || !(await getProject(projectId))) return { ok: false };
  const current = postId ? (isUuid(postId) ? await getPost(postId) : null) : null;
  const images = v.images === undefined ? undefined : resolveImages(v.images, current && current.project_id === projectId ? current : null);
  if (images === null) return { ok: false, error: L("圖片不對，請重新選一次", "Something's off with the images. Pick them again.") };
  const input: PostInput = { platform: v.platform, format: v.format, kind: v.kind, target: v.target, date: v.date, time: v.time, topic: v.topic, body: v.body, status: v.status, images, note: v.note };
  if (postId) {
    const post = current;
    if (!post || post.project_id !== projectId) return { ok: false, error: L("找不到這則貼文", "Post not found") };
    const r = await updatePost(post, input);
    return r.post ? done() : { ok: false, error: r.error };
  }
  const r = await createPost(projectId, input);
  return r.post ? done() : { ok: false, error: r.error };
}

async function own(id: string) {
  const post = isUuid(id) ? await getPost(id) : null;
  if (!post) return null;
  await requireProjectEdit(post.project_id);
  return post;
}

export async function setPostStatusAction(id: string, status: PostStatus): Promise<PostResult> {
  const post = await own(id);
  if (!post || !isPostStatus(status)) return { ok: false };
  await setPostStatus(post, status);
  return done();
}

export async function postponePostAction(id: string): Promise<PostResult> {
  const post = await own(id);
  if (!post) return { ok: false };
  await postponePost(post);
  return done();
}

export async function deletePostAction(id: string): Promise<PostResult> {
  const post = await own(id);
  if (!post) return { ok: false };
  await deletePost(post);
  return done();
}

/** AI 依專案描述與主題寫草稿（不存檔，回傳給表單讓你改） */
export async function draftPostAction(projectId: string, v: { platform: string; format?: string; kind?: string | null; target: string; topic: string }): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  const project = isUuid(projectId) ? await getProject(projectId) : null;
  if (!project || !isPlatform(v.platform)) return { ok: false };
  const topic = String(v.topic ?? "").trim().slice(0, 300);
  if (!topic) return { ok: false, error: L("先填主題，AI 才知道要寫什麼", "Add a topic first") };
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，AI 寫草稿不能用。", "ANTHROPIC_API_KEY isn't set, so AI drafts are unavailable.") };
  try {
    const format: PostFormat = isFormat(v.format) ? v.format : "post";
    const draft = await draftPost(project, { platform: v.platform, format, kind: isKind(v.kind) ? v.kind : null, target: String(v.target ?? "").slice(0, 300), topic });
    return draft ? { ok: true, draft } : { ok: false, error: L("AI 沒有寫出內容，再按一次試試。", "No draft came back. Try again.") };
  } catch {
    return { ok: false, error: L("AI 暫時寫不出來，等一下再試。", "The AI couldn't write this right now. Try again shortly.") };
  }
}

// ---------- 成效檢討 ----------

/** 存已發貼文的成效數字（全部留空＝清掉） */
export async function saveMetricsAction(id: string, input: Record<string, string>): Promise<PostResult> {
  const post = await own(id);
  if (!post) return { ok: false };
  const r = await saveMetrics(post, input);
  if (!r.ok) return { ok: false, error: r.error };
  return done();
}

/** 讀洞察報告截圖上的數字（不存檔，填回表單讓你核對） */
export async function readMetricsAction(projectId: string, image: string): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，截圖讀數字不能用，請自己填。", "ANTHROPIC_API_KEY isn't set, so reading screenshots is unavailable.") };
  try {
    const r = await readMetricsImage(String(image ?? ""));
    return r.metrics ? { ok: true, metrics: r.metrics } : { ok: false, error: r.error };
  } catch {
    return { ok: false, error: L("AI 暫時讀不了，請自己填或等一下再試。", "The AI couldn't read this right now. Fill it in or try again shortly.") };
  }
}

/** 請 AI 解讀這個專案的成效 */
export async function auditAdviceAction(projectId: string): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  const project = isUuid(projectId) ? await getProject(projectId) : null;
  if (!project) return { ok: false };
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，AI 解讀不能用。", "ANTHROPIC_API_KEY isn't set, so the AI review is unavailable.") };
  try {
    const { posts } = await listPosts(projectId);
    const r = await auditAdvice(project, posts);
    return r.text ? { ok: true, draft: r.text } : { ok: false, error: r.error };
  } catch {
    return { ok: false, error: L("AI 暫時解讀不了，等一下再試。", "The AI couldn't review this right now. Try again shortly.") };
  }
}

// ---------- 互動：回覆留言、私訊、去別人貼文留言 ----------

type Engage = { replies?: ReplyOut[]; dm?: DmOut; comment?: CommentOut; profile?: ProfileResult };
export type EngageResult = { ok: boolean; error?: string } & Engage;

/** 共用：權限、專案、AI 開關、錯誤訊息 */
async function withProject(projectId: string, fn: (project: NonNullable<Awaited<ReturnType<typeof getProject>>>) => Promise<Engage & { error?: string }>): Promise<EngageResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  const project = isUuid(projectId) ? await getProject(projectId) : null;
  if (!project) return { ok: false };
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，這個功能不能用。", "ANTHROPIC_API_KEY isn't set, so this is unavailable.") };
  try {
    const r = await fn(project);
    return r.error ? { ok: false, error: r.error } : { ok: true, ...r };
  } catch {
    return { ok: false, error: L("AI 暫時寫不出來，等一下再試。", "The AI couldn't do this right now. Try again shortly.") };
  }
}

export async function draftRepliesAction(projectId: string, comments: string, context: string): Promise<EngageResult> {
  return withProject(projectId, (p) => draftReplies(p, String(comments ?? "").slice(0, 20_000), String(context ?? "")));
}

export async function draftDmAction(projectId: string, v: DmInput): Promise<EngageResult> {
  return withProject(projectId, (p) => draftDm(p, { kind: v?.kind, who: String(v?.who ?? ""), trigger: String(v?.trigger ?? ""), want: String(v?.want ?? ""), give: String(v?.give ?? "") }));
}

export async function draftCommentsAction(projectId: string, v: { account: string; post: string; mine: string }): Promise<EngageResult> {
  return withProject(projectId, (p) => draftComments(p, { account: String(v?.account ?? ""), post: String(v?.post ?? ""), mine: String(v?.mine ?? "") }));
}

/** 個人檔案健檢（結果存在這個專案底下） */
export async function checkProfileAction(projectId: string, fields: Record<string, string>, image?: string | null): Promise<EngageResult> {
  const r = await withProject(projectId, async (p) => {
    const out = await checkProfile(p, fields, image ?? null);
    return out.result ? { profile: out.result } : { error: out.error };
  });
  if (r.ok) revalidatePath("/social");
  return r;
}

// ---------- 每週內容規劃 ----------

/** AI 排這一週（不存檔，回傳給畫面勾選） */
export async function planWeekAction(projectId: string, week: string, note: string): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  const project = isUuid(projectId) ? await getProject(projectId) : null;
  if (!project || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return { ok: false };
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，AI 排這週不能用。", "ANTHROPIC_API_KEY isn't set, so AI planning is unavailable.") };
  try {
    const r = await planWeek(project, weekStart(week), taipeiDate(), String(note ?? "").slice(0, 1500));
    return r.slots ? { ok: true, slots: r.slots } : { ok: false, error: r.error };
  } catch {
    return { ok: false, error: L("AI 暫時排不出來，等一下再試。", "The AI couldn't plan this right now. Try again shortly.") };
  }
}

/** 把勾選的幾則存成草稿（只有主題，文案之後再寫） */
export async function savePlanAction(projectId: string, slots: PlanSlot[]): Promise<PostResult> {
  await requireProjectEdit(projectId);
  if (!isUuid(projectId) || !(await getProject(projectId))) return { ok: false };
  const today = taipeiDate();
  // 畫面傳回來的內容再檢查一次（日期不能是過去）
  const dates = [...new Set((Array.isArray(slots) ? slots : []).map((s) => String(s?.date ?? "")))].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today);
  const clean = cleanPlan({ slots }, dates);
  if (!clean.length) return { ok: false, error: "沒有可以存的內容" };
  let saved = 0;
  let error: string | undefined;
  for (const s of clean) {
    const r = await createPost(projectId, { platform: s.platform, format: s.format, kind: s.kind, target: "", date: s.date, time: s.time, topic: s.topic, body: "", status: "draft" });
    if (r.post) saved++;
    else error = r.error;
  }
  if (!saved) return { ok: false, error };
  revalidatePath("/social");
  revalidatePath("/projects");
  return { ok: true, saved, error };
}

// ---------- 爆款靈感庫 ----------

export async function addSwipeAction(projectId: string, v: SwipeInput): Promise<PostResult> {
  await requireProjectEdit(projectId);
  if (!isUuid(projectId) || !(await getProject(projectId))) return { ok: false };
  const r = await addSwipe(projectId, v);
  if (!r.swipe) return { ok: false, error: r.error };
  revalidatePath("/social");
  return { ok: true };
}

export async function deleteSwipeAction(id: string): Promise<PostResult> {
  const swipe = isUuid(id) ? await getSwipe(id) : null;
  if (!swipe) return { ok: false };
  await requireProjectEdit(swipe.project_id);
  await deleteSwipe(id);
  revalidatePath("/social");
  return { ok: true };
}
