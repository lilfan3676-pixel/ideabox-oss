"use server";

import { revalidatePath } from "next/cache";
import { requireProjectEdit } from "@/lib/auth";
import { getL } from "@/lib/i18nServer";
import { sniffImageType, storeImage } from "@/lib/images";
import { isPlatform, isPostStatus, type PostStatus } from "@/lib/postLogic";
import { createPost, deletePost, draftEnabled, draftPost, getPost, postponePost, setPostStatus, updatePost, type PostInput } from "@/lib/posts";
import { getProject } from "@/lib/projects";

// 發文排程的動作：主人，或這個專案「可編輯」的合夥人才能用（requireProjectEdit）

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
export type PostResult = { ok: boolean; error?: string; draft?: string };
const done = (): PostResult => {
  revalidatePath("/projects");
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

export async function savePostAction(projectId: string, postId: string | null, v: Omit<PostInput, "imagePath"> & { image?: string | null }): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  if (!isUuid(projectId) || !(await getProject(projectId))) return { ok: false };
  let imagePath: string | null | undefined;
  try {
    imagePath = await saveImage(v.image);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : L("圖片存不進去", "Couldn't save the image") };
  }
  const input: PostInput = { platform: v.platform, target: v.target, date: v.date, time: v.time, topic: v.topic, body: v.body, status: v.status, imagePath };
  if (postId) {
    const post = isUuid(postId) ? await getPost(postId) : null;
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
export async function draftPostAction(projectId: string, v: { platform: string; target: string; topic: string }): Promise<PostResult> {
  await requireProjectEdit(projectId);
  const L = await getL();
  const project = isUuid(projectId) ? await getProject(projectId) : null;
  if (!project || !isPlatform(v.platform)) return { ok: false };
  const topic = String(v.topic ?? "").trim().slice(0, 300);
  if (!topic) return { ok: false, error: L("先填主題，AI 才知道要寫什麼", "Add a topic first") };
  if (!draftEnabled()) return { ok: false, error: L("還沒設定 ANTHROPIC_API_KEY，AI 寫草稿不能用。", "ANTHROPIC_API_KEY isn't set, so AI drafts are unavailable.") };
  try {
    const draft = await draftPost(project, { platform: v.platform, target: String(v.target ?? "").slice(0, 300), topic });
    return draft ? { ok: true, draft } : { ok: false, error: L("AI 沒有寫出內容，再按一次試試。", "No draft came back. Try again.") };
  } catch {
    return { ok: false, error: L("AI 暫時寫不出來，等一下再試。", "The AI couldn't write this right now. Try again shortly.") };
  }
}
