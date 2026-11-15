import "server-only";
import { db, type Idea } from "./db";
import { pickFolder, sortFolders, type Folder } from "./folderLogic";

// 資料夾的讀寫。還沒執行 migration-010 時一律回傳空的、不丟錯，點子照常存。

export type { Folder } from "./folderLogic";

export async function listFolders(): Promise<{ folders: Folder[]; ready: boolean }> {
  const { data, error } = await db().from("folders").select("*").order("sort", { ascending: true });
  if (error) return { folders: [], ready: false };
  return { folders: sortFolders((data ?? []) as Folder[]), ready: true };
}

/** 分析完後自動歸檔：你手動搬過的（folder_locked）不動 */
export async function autoFile(idea: Idea, aiName: unknown, folders: Folder[]): Promise<Idea> {
  if (idea.folder_locked || !folders.length) return idea;
  const folderId = pickFolder(folders, aiName, idea.category);
  if (folderId === (idea.folder_id ?? null)) return idea;
  const { error } = await db().from("ideas").update({ folder_id: folderId }).eq("id", idea.id);
  return error ? idea : { ...idea, folder_id: folderId };
}

/** 手動搬移（網頁拖曳、勾選搬移、Telegram 按鈕）：之後 AI 重新分析也不會再改 */
export async function moveToFolder(ids: string[], folderId: string | null): Promise<number> {
  if (!ids.length) return 0;
  if (folderId) {
    const { data } = await db().from("folders").select("id").eq("id", folderId).maybeSingle();
    if (!data) return 0;
  }
  const { data, error } = await db().from("ideas").update({ folder_id: folderId, folder_locked: true }).in("id", ids).select("id");
  if (error) throw error;
  return (data ?? []).length;
}
