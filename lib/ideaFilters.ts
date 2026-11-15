import type { Idea } from "./db";
import { CATEGORIES } from "./scoring";

/** 點子庫上方的篩選條件（都存在網址參數，重新整理後保留） */
export type IdeaFilters = {
  adopt: "" | "yes" | "no"; // 採用狀態
  project: string; // "" = 全部、"none" = 沒指定專案、其他 = 專案 id
  min: number; // 綜合分數下限，0 = 不限
  cat: string; // 分類，"" = 全部
};

export const NO_PROJECT = "none";
export const MIN_SCORES = [6, 7, 8] as const;

/** 網址參數 → 篩選條件（不認得的值當作沒篩選） */
export function parseFilters(p: { adopt?: string; project?: string; min?: string; cat?: string }): IdeaFilters {
  const min = Number(p.min);
  return {
    adopt: p.adopt === "yes" || p.adopt === "no" ? p.adopt : "",
    project: (p.project ?? "").slice(0, 40),
    min: (MIN_SCORES as readonly number[]).includes(min) ? min : 0,
    cat: (CATEGORIES as readonly string[]).includes(p.cat ?? "") ? (p.cat as string) : "",
  };
}

export const hasFilters = (f: IdeaFilters) => !!(f.adopt || f.project || f.min || f.cat);

export function matchFilters(i: Idea, f: IdeaFilters): boolean {
  if (f.adopt === "yes" && !i.adopted) return false;
  if (f.adopt === "no" && i.adopted) return false;
  if (f.project === NO_PROJECT ? !!i.project_id : f.project && i.project_id !== f.project) return false;
  if (f.min && (i.score_total ?? 0) < f.min) return false;
  if (f.cat && (i.category ?? "other") !== f.cat) return false;
  return true;
}

/** 已採用的拉到最上面一區；排序不變 */
export function splitAdopted(list: Idea[]): { adopted: Idea[]; rest: Idea[] } {
  const adopted: Idea[] = [];
  const rest: Idea[] = [];
  for (const i of list) (i.adopted ? adopted : rest).push(i);
  return { adopted, rest };
}
