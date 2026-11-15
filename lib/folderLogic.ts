// 資料夾規則（純函式，前後端共用、方便測試）

export type Folder = { id: string; name: string; sort: number; category: string | null; color?: string | null; created_at?: string };

/** 資料夾可選的顏色（null = 跟著主題的強調色） */
export const FOLDER_COLORS: Record<string, string> = {
  orange: "#f59e0b",
  pink: "#ec4899",
  purple: "#8b5cf6",
  blue: "#3b82f6",
  teal: "#14b8a6",
  green: "#22c55e",
  red: "#ef4444",
  gray: "#94a3b8",
};
export const folderColor = (c: string | null | undefined) => (c && FOLDER_COLORS[c]) || "var(--accent)";

export const FOLDER_NAME_MAX = 20;

/** 整理資料夾名稱：去頭尾空白、壓縮空白、限制長度 */
export function cleanFolderName(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, FOLDER_NAME_MAX);
}

/** AI 猜資料夾：先看 AI 選的名稱，對不到就用分類對應的預設資料夾，都沒有就未分類（null） */
export function pickFolder(folders: Folder[], aiName: unknown, category: string | null | undefined): string | null {
  const name = cleanFolderName(aiName);
  if (name) {
    const hit = folders.find((f) => f.name === name) ?? folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
  }
  if (category) {
    const byCat = folders.find((f) => f.category === category);
    if (byCat) return byCat.id;
  }
  return null;
}

export const sortFolders = (fs: Folder[]) =>
  [...fs].sort((a, b) => a.sort - b.sort || (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.name.localeCompare(b.name));

/** 拖曳排序：把 id 移到 targetId 的位置，回傳新的順序（id 陣列） */
export function reorder(ids: string[], id: string, targetId: string): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids;
  // 用目標原本的位置插入：往後拖會落在目標後面、往前拖落在目標前面（跟拖曳直覺一致）
  const to = ids.indexOf(targetId);
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}
