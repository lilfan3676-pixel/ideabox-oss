// 合夥人權限（純邏輯，瀏覽器、伺服器、測試都能用）
// 主人看得到全部；合夥人只看得到勾選的「畫面」與「專案」。成本、設定、辦公室與私人模組永遠只有主人看得到。

import { MODULE_MEMBER_PAGES } from "./modules/memberPages";

const CORE_MEMBER_PAGES = [
  { key: "projects", zh: "專案（卡片＋詳細頁）", en: "Projects (cards + detail)" },
  { key: "calendar", zh: "月曆／時程表", en: "Calendar / timeline" },
  { key: "monitor", zh: "產品監控", en: "Product monitor" },
  { key: "ideas", zh: "點子庫（只限他的專案）", en: "Ideas (their projects only)" },
  { key: "radar", zh: "話題雷達", en: "Topic radar" },
  { key: "grants", zh: "補助雷達", en: "Grants" },
] as const;

/** 可以勾給合夥人的畫面：核心的＋模組自己的頁面（lib/modules/memberPages.ts） */
export const MEMBER_PAGES: readonly { key: PageKey; zh: string; en: string }[] = [...CORE_MEMBER_PAGES, ...MODULE_MEMBER_PAGES];

export type PageKey = (typeof CORE_MEMBER_PAGES)[number]["key"] | (typeof MODULE_MEMBER_PAGES)[number]["key"];
const PAGE_KEYS = MEMBER_PAGES.map((p) => p.key) as readonly string[];

export type Member = {
  id: string;
  email: string;
  name: string;
  project_ids: string[];
  pages: string[];
  can_edit: boolean;
  push: boolean;
  active: boolean;
  user_id: string | null;
  invite_exp: string | null;
  last_login_at: string | null;
  created_at: string;
};

/** 目前這個人能看什麼：主人＝全部 */
export type Access =
  | { owner: true; name?: string }
  | { owner: false; memberId: string; name: string; pages: PageKey[]; projects: string[]; canEdit: boolean };

export const OWNER_ACCESS: Access = { owner: true };

export function accessOf(m: Pick<Member, "id" | "name" | "pages" | "project_ids" | "can_edit">): Access {
  return {
    owner: false,
    memberId: m.id,
    name: m.name,
    pages: (m.pages ?? []).filter((p): p is PageKey => PAGE_KEYS.includes(p)),
    projects: Array.isArray(m.project_ids) ? m.project_ids : [],
    canEdit: !!m.can_edit,
  };
}

export const can = (a: Access, page: PageKey) => a.owner || a.pages.includes(page);
export const seesProject = (a: Access, projectId: string | null | undefined) => a.owner || (!!projectId && a.projects.includes(projectId));
/** 在這個專案裡勾里程碑、改排程、寫日誌 */
export const editsProject = (a: Access, projectId: string | null | undefined) => a.owner || (a.canEdit && seesProject(a, projectId) && (can(a, "projects") || can(a, "calendar")));

export function filterByProject<T extends { project_id?: string | null }>(a: Access, rows: T[]): T[] {
  return a.owner ? rows : rows.filter((r) => seesProject(a, r.project_id));
}

/** 上方選單看得到的頁面網址（主人回傳 null＝全部） */
export function navHrefs(a: Access): string[] | null {
  if (a.owner) return null;
  const out: string[] = [];
  if (can(a, "ideas")) out.push("/");
  if (can(a, "projects") || can(a, "calendar")) out.push("/projects");
  if (can(a, "grants")) out.push("/grants");
  if (can(a, "monitor")) out.push("/monitor");
  for (const p of MODULE_MEMBER_PAGES) if (can(a, p.key)) out.push(p.href);
  return out;
}

/** 合夥人登入後第一個畫面；什麼都沒開就是「沒有權限」頁 */
export function homeHref(a: Access): string {
  if (a.owner) return "/";
  if (can(a, "projects")) return "/projects";
  if (can(a, "calendar")) return "/projects?view=calendar";
  if (can(a, "monitor")) return "/monitor";
  if (can(a, "ideas")) return "/";
  if (can(a, "grants")) return "/grants";
  for (const p of MODULE_MEMBER_PAGES) if (can(a, p.key)) return p.href;
  return "/no-access";
}

/** 手機 App 顯示哪些分頁（今天一定有；辦公室只有主人） */
export function appTabs(a: Access): string[] {
  if (a.owner) return ["today", "calendar", "projects", "monitor", "office"];
  const tabs = ["today"];
  if (can(a, "calendar")) tabs.push("calendar");
  if (can(a, "projects")) tabs.push("projects");
  if (can(a, "monitor")) tabs.push("monitor");
  return tabs;
}

// ---------- 範本與輸入檢查 ----------

export const MEMBER_TEMPLATES: { key: string; zh: string; en: string; pages: PageKey[]; canEdit: boolean }[] = [
  { key: "cofounder", zh: "共同創辦人", en: "Co-founder", pages: ["projects", "calendar", "monitor"], canEdit: true },
  { key: "advisor", zh: "顧問（只看進度）", en: "Advisor (view only)", pages: ["projects", "calendar"], canEdit: false },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MemberInput = { name: unknown; email?: unknown; projects: unknown; pages: unknown; canEdit: unknown; push: unknown };
export type CleanMember = { name: string; email: string; project_ids: string[]; pages: PageKey[]; can_edit: boolean; push: boolean };

/** 檢查表單：錯誤回傳 { error: [中文, 英文] } */
export function cleanMember(v: MemberInput, ownerEmail: string, knownProjects: string[], needEmail = true): CleanMember | { error: [string, string] } {
  const name = String(v.name ?? "").trim().slice(0, 30);
  const email = String(v.email ?? "").trim().toLowerCase().slice(0, 120);
  if (!name) return { error: ["請填名字", "Enter a name"] };
  if (needEmail) {
    if (!EMAIL.test(email)) return { error: ["Email 格式不對", "That email doesn't look right"] };
    if (email === ownerEmail.toLowerCase()) return { error: ["這是你自己的 Email", "That's your own email"] };
  }
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : []);
  const project_ids = [...new Set(list(v.projects).filter((id) => UUID.test(id) && knownProjects.includes(id)))];
  const pages = [...new Set(list(v.pages).filter((p): p is PageKey => PAGE_KEYS.includes(p)))];
  if (!project_ids.length) return { error: ["至少勾一個專案", "Pick at least one project"] };
  if (!pages.length) return { error: ["至少勾一個畫面", "Pick at least one screen"] };
  // 話題雷達在專案詳細頁裡，沒有「專案」就看不到
  if (pages.includes("radar") && !pages.includes("projects")) return { error: ["話題雷達要和「專案」一起開", "Topic radar needs Projects too"] };
  return { name, email, project_ids, pages, can_edit: v.canEdit === true || v.canEdit === "true", push: v.push === true || v.push === "true" };
}

export const INVITE_TTL_MS = 7 * 86_400_000;
export const MIN_PASSWORD = 8;

/** 日誌記上是誰改的（合夥人才加前綴） */
export const byWho = (a: Access, text: string) => (a.owner ? text : `${a.name}：${text}`);

/** 合夥人看得到的監控產品：對得到他專案短名的（產品的 key 或 slugs） */
export function productsFor<T extends { key: string; slugs?: string[] }>(a: Access, visibleSlugs: string[], products: T[]): T[] {
  if (a.owner) return products;
  return products.filter((p) => visibleSlugs.includes(p.key) || (p.slugs ?? []).some((s) => visibleSlugs.includes(s)));
}

/** 推送給誰：沒有範圍＝只給你；有範圍時，合夥人要開了推送、有其中一個畫面權限、而且看得到其中一個專案 */
export type PushScope = { projectIds: string[]; pages: PageKey[] };

export function memberGetsPush(m: Pick<Member, "id" | "name" | "pages" | "project_ids" | "can_edit" | "active" | "push">, scope?: PushScope): boolean {
  if (!scope || !m.active || !m.push) return false;
  const a = accessOf(m);
  return scope.pages.some((p) => can(a, p)) && scope.projectIds.some((id) => seesProject(a, id));
}
