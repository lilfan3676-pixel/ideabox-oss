// 左側選單怎麼分：主要的、收進「更多」的、搬進專案頁的（純函式）

export type NavEntry = { href: string; project?: string; more?: boolean };

/** 這一頁是不是收進專案頁了：某個專案自己的工具，看的人是主人、而且那個專案存在 */
export function inProject(p: NavEntry, owner: boolean, slugs: readonly string[]): boolean {
  return !!p.project && owner && slugs.includes(p.project);
}

/** 選單分成三堆：main＝左側圖示列、more＝「更多」裡、tools＝搬進專案頁的 */
export function splitNav<T extends NavEntry>(pages: readonly T[], owner: boolean, slugs: readonly string[]): { main: T[]; more: T[]; tools: T[] } {
  const main: T[] = [];
  const more: T[] = [];
  const tools: T[] = [];
  for (const p of pages) (inProject(p, owner, slugs) ? tools : p.more ? more : main).push(p);
  return { main, more, tools };
}

/** 網址落在哪一頁（最長的那個相符的；「/」只認自己） */
export function pageOf<T extends NavEntry>(pages: readonly T[], pathname: string): T | undefined {
  return pages.filter((p) => p.href !== "/" && (pathname === p.href || pathname.startsWith(p.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0];
}
