import "server-only";
import { editsProject, type Access } from "./accessLogic";
import { taipeiDate } from "./dates";
import { FOLDER_COLORS } from "./folderLogic";
import { projectTabs } from "./modules/registry";
import type { ProjectTab } from "./modules/types";
import { listPosts } from "./posts";
import type { Project } from "./projectLogic";

/** 分頁列上的一格（傳給瀏覽器的純資料）。href＝這個分頁在別的頁面；tool＝那一頁是這個專案自己的工具（上面有同一排分頁） */
export type TabDef = { key: string; label: [string, string]; count?: number; href?: string; tool?: boolean };

/** 專案在清單裡第幾個就用第幾個顏色（專案頁、工具頁上面的專案名稱用同一個） */
export const projectColor = (index: number) => Object.values(FOLDER_COLORS)[Math.max(0, index) % Object.values(FOLDER_COLORS).length];

/** 專案頁上面那一排分頁：總覽、發文排程（在社群助手，這裡是捷徑）、模組替這個專案加的（專案自己的工具）。
 *  專案詳細頁與工具頁共用，兩邊看到的是同一排。 */
export async function buildProjectTabs(project: Project, access: Access): Promise<{ tabs: TabDef[]; extra: ProjectTab[] }> {
  const [postList, extra] = await Promise.all([
    listPosts(project.id).catch(() => ({ posts: [] as Awaited<ReturnType<typeof listPosts>>["posts"] })),
    projectTabs({ project, access, canEdit: editsProject(access, project.id), today: taipeiDate() }),
  ]);
  const tabs: TabDef[] = [
    { key: "", label: ["總覽", "Overview"] },
    { key: "posts", href: `/social?p=${project.slug}`, label: ["發文排程", "Posts"], count: postList.posts.filter((x) => x.status === "draft" || x.status === "scheduled").length },
  ];
  for (const t of extra) tabs.push({ key: t.key, label: t.label, count: t.count, href: t.href, tool: t.tool });
  return { tabs, extra };
}
