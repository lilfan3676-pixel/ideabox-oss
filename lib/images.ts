import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { fetchWithTimeout } from "./threads";

// 圖片存在 Supabase Storage 的私有空間，只有伺服器能讀寫；網頁用有時效的簽名網址顯示。
const BUCKET = "idea-images";
const MAX_BYTES = 5_000_000; // Claude 圖片上限 5MB
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export type ImageData = { mediaType: string; base64: string };

/** 偵測真正的圖片格式（不信任伺服器回傳的 content-type） */
export function sniffImageType(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}

/** 從網址下載圖片（只接受 jpeg/png/webp/gif，5MB 以內） */
export async function downloadImage(url: string): Promise<ImageData | null> {
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": "facebookexternalhit/1.1" } }, 10_000);
  if (!res || !res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) return null;
  const mediaType = sniffImageType(buf);
  if (!mediaType) return null;
  return { mediaType, base64: Buffer.from(buf).toString("base64") };
}

/** 上傳到 Storage，回傳路徑；失敗回傳 null（不影響點子本身的儲存） */
export async function storeImage(img: ImageData): Promise<string | null> {
  const ext = TYPES[img.mediaType];
  if (!ext) return null;
  const path = `ideas/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  try {
    const { error } = await db()
      .storage.from(BUCKET)
      .upload(path, Buffer.from(img.base64, "base64"), { contentType: img.mediaType, upsert: false });
    if (error) {
      console.error("storeImage failed", error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.error("storeImage error", err);
    return null;
  }
}

/** 重新分析時讀回已存的圖片 */
export async function loadStoredImage(path: string): Promise<ImageData | null> {
  try {
    const { data, error } = await db().storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const buf = new Uint8Array(await data.arrayBuffer());
    const mediaType = sniffImageType(buf);
    if (!mediaType) return null;
    return { mediaType, base64: Buffer.from(buf).toString("base64") };
  } catch {
    return null;
  }
}

/** 批次產生簽名網址（顯示縮圖或放進簡報用） */
export async function signedUrls(paths: string[], seconds: number): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const { data } = await db().storage.from(BUCKET).createSignedUrls(unique, seconds);
    const out: Record<string, string> = {};
    for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
    return out;
  } catch {
    return {};
  }
}

export async function removeImage(path: string | null | undefined) {
  if (!path) return;
  try {
    await db().storage.from(BUCKET).remove([path]);
  } catch {
    /* 刪不掉也不影響 */
  }
}
