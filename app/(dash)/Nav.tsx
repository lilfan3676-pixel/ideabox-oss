"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useL } from "../LangProvider";
import { LangSwitch } from "./LangSwitch";
import { withViewTransition } from "./viewTransition";
import { saveUiTheme } from "./actions";
import { metaModules } from "@/lib/modules/meta";
import { can, memberViews, navHrefs, type Access } from "@/lib/accessLogic";
import { useAccess } from "./AccessContext";
import { inProject, pageOf, splitNav } from "@/lib/navLogic";
import {
  IconAlert,
  IconArchive,
  IconCalendar,
  IconCheck,
  IconDots,
  IconClipboard,
  IconClock,
  IconGrid,
  IconInfinity,
  IconLink,
  IconMail,
  IconMoon,
  IconPalette,
  IconPhone,
  IconPulse,
  IconMegaphone,
  IconFlame,
  IconSearch,
  IconChat,
  IconTrend,
  IconList,
  IconSparkle,
  IconSun,
  IconBulb,
  IconUsers,
  IconBox,
  IconPercent,
  IconSettings,
} from "./icons";

type NavItem = { href: string; label: string; short?: string; hideSm?: boolean; icon?: React.ReactNode; /** 某個專案自己的工具（專案短名） */ project?: string; /** 收進「更多」 */ more?: boolean };

const CORE_PAGES: NavItem[] = [
  { href: "/", label: "點子庫", short: "點子", icon: <IconBulb /> },
  { href: "/projects", label: "專案", icon: <IconClipboard /> },
  { href: "/social", label: "社群助手", short: "社群", icon: <IconMegaphone /> },
  { href: "/office", label: "辦公室", icon: <IconBox /> },
  { href: "/grants", label: "補助雷達", short: "補助", more: true, icon: <IconSparkle /> }, // 一週才更新一次，收在「更多」
  { href: "/monitor", label: "監控", icon: <IconPulse /> },
  { href: "/costs", label: "成本", icon: <IconPercent /> },
  { href: "/settings", label: "設定", hideSm: true, icon: <IconSettings /> }, // 手機版放在頭像選單裡
];

// 模組（lib/modules/meta.tsx）多出的頁面：排在指定頁面後面，沒指定就排在「設定」前面
const PAGES = (() => {
  const list = [...CORE_PAGES];
  for (const p of metaModules.flatMap((m) => m.pages ?? [])) {
    const at = p.after ? list.findIndex((x) => x.href === p.after) + 1 : list.length - 1;
    list.splice(at > 0 ? at : list.length - 1, 0, { href: p.href, label: p.label, short: p.short, hideSm: p.hideSm, icon: p.icon, project: p.project, more: p.more });
  }
  return list;
})();

// 導覽文字的英文（中文是原文，切換成英文介面時查這張表）
const NAV_EN: Record<string, string> = {
  點子庫: "Ideas", 點子: "Ideas", 專案: "Projects", 辦公室: "Office", 整棟大樓: "Whole building", 全部專案: "All projects", 專案卡片: "Project cards", 月曆: "Calendar", 進行中: "Active", "暫停／完成": "Paused / done", 設計庫: "Design", 設計: "Design", 封測: "Beta", 補助雷達: "Grants", 補助: "Grants",
  監控: "Monitor", 成本: "Costs", 設定: "Settings", 更多: "More",
  社群助手: "Social", 社群: "Social", 一週看板: "Week board", 排程清單: "All posts", 靈感庫: "Swipe file", 海巡: "Patrol", 成效: "Results", 互動: "Engage", 檔案健檢: "Profile check",
  待審核: "To review", 已核准: "Approved", 已同步: "Synced", 已淘汰: "Rejected",
  全部點子: "All ideas", 本週: "This week", 待補充: "Needs input", 已採用: "Adopted",
  全部設計: "All designs", 介面設計: "UI design", "GitHub 資源": "GitHub", 已選入簡報: "In brief",
  未處理: "Open", 嚴重: "Critical", Bug: "Bugs", "全部（含已處理）": "All (incl. handled)",
  全部開放中: "All open", "30 天內截止": "Due in 30 days", 常態受理: "Rolling", "已截止／不適合": "Closed / not a fit",
  全部產品: "All products",
  總覽: "Overview", 訂閱: "Subscriptions", 一次性開銷: "One-time", "AI 用量": "AI usage",
  產品描述: "Product", 專案描述: "Projects", 連線狀態: "Connections", 外觀: "Appearance", 週報: "Digest", "AI 學習": "AI learning", "手機 App": "Phone app", 合夥人: "Partners",
  // 模組提供的英文
  ...Object.fromEntries(
    metaModules.flatMap((m) => [
      ...(m.pages ?? []).flatMap((p) => [[p.label, p.en], ...(p.short ? [[p.short, p.shortEn ?? p.en]] : [])]),
      ...Object.values(m.rails ?? {}).flatMap((r) => r.items.map((it) => [it.label, it.en])),
    ]),
  ),
};
const navT = (L: (zh: string, en: string) => string, zh: string) => L(zh, NAV_EN[zh] ?? zh);

/** 給手機版「更多」選單用：所有頁面（網址、中文、英文） */
export const ALL_PAGES: Array<[string, string, string]> = PAGES.map((p) => [p.href, p.label, NAV_EN[p.label] ?? p.label]);

/** 手機版「更多」選單：搬進專案頁的工具不列（從專案頁的分頁進去） */
export function menuPages(a: Access, slugs: readonly string[]): Array<[string, string, string]> {
  const hidden = new Set(splitNav(PAGES, a.owner, slugs).tools.map((p) => p.href));
  return ALL_PAGES.filter(([href]) => !hidden.has(href));
}

/** 這個網址是不是某個專案自己的工具頁（而且已經收進專案頁）：回傳專案短名 */
function toolProject(pathname: string, a: Access, slugs: readonly string[]): string | null {
  const hit = pageOf(PAGES, pathname);
  return hit && inProject(hit, a.owner, slugs) ? hit.project! : null;
}

/** ctx＝看的人與現有的專案：專案自己的工具頁算在「專案」底下（左側亮的是專案） */
function currentPage(pathname: string, ctx?: { a: Access; slugs: readonly string[] }) {
  if (ctx && toolProject(pathname, ctx.a, ctx.slugs)) return "/projects";
  if (pathname.startsWith("/design")) return "/"; // 設計庫已併進點子庫（/design/brief 簡報頁仍在）
  if (pathname.startsWith("/account")) return "/account"; // 合夥人的「我的帳號」：不在選單裡
  // 模組掛在某一頁檢視列裡的「另一個網址」（RailItem.href）：到了那個網址，仍然算在那一頁底下
  for (const [page, r] of Object.entries(RAIL)) if (r.items.some((it) => it.href && (pathname === it.href || pathname.startsWith(it.href + "/")))) return page;
  const hit = PAGES.find((p) => p.href !== "/" && (pathname === p.href || pathname.startsWith(p.href + "/")));
  return hit?.href ?? "/";
}

/** 合夥人只看得到有權限的頁面（主人全部）；main＝左側圖示列、more＝收在「更多」裡（專案自己的工具不在這裡，在專案頁） */
function visiblePages(a: Access, slugs: readonly string[]) {
  const allowed = navHrefs(a);
  const { main, more } = splitNav(allowed ? PAGES.filter((p) => allowed.includes(p.href)) : PAGES, a.owner, slugs);
  // 「更多」排在「設定」前面；裡面只有一個也照樣收（使用者要選單短）
  return { main, more };
}

/** 分頁在左側圖示列的順序（換頁動畫依此決定往左或往右滑） */
export function pageIndex(pathname: string): number {
  return PAGES.findIndex((p) => p.href === currentPage(pathname));
}

/** 點下去立刻顯示選中狀態，不用等伺服器回應（換頁完成後自動同步回實際狀態） */
function usePendingValue(actual: string) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [actual]);
  return [pending ?? actual, setPending] as const;
}

/** 頂部列左邊的頁面名稱（左側圖示列只有圖示，這裡寫出現在在哪一頁） */
export function PageName({ slugs = [] }: { slugs?: string[] }) {
  const page = currentPage(usePathname(), { a: useAccess(), slugs });
  const L = useL();
  const p = PAGES.find((x) => x.href === page);
  return <h1 className="page-name">{p ? navT(L, p.label) : page === "/account" ? L("我的帳號", "My account") : ""}</h1>;
}

/** 左側圖示列：切換頁面（滑過去顯示名稱） */
export function TopNav({ slugs = [] }: { slugs?: string[] }) {
  const a = useAccess();
  const actual = currentPage(usePathname(), { a, slugs });
  const [page, setPage] = usePendingValue(actual);
  const L = useL();
  const router = useRouter();
  const { main: PAGES, more: MORE } = visiblePages(a, slugs);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [actual]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => !(e.target as HTMLElement).closest(".rail-more") && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // 鍵盤左右鍵切換頁面（正在打字、按著修飾鍵、或有彈出視窗時不作用）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest("[role=slider], [role=tablist], .tv-lightweight-charts"))) return;
      if (document.querySelector("dialog[open], [aria-modal=true], .ctx-menu, .menu.open, .bell-panel")) return;
      const i = PAGES.findIndex((p) => p.href === page);
      const next = PAGES[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (i < 0 || !next) return;
      e.preventDefault();
      setPage(next.href);
      router.push(next.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, router, setPage, PAGES]);
  const link = (p: NavItem) => (
    <Link
      key={p.href}
      href={p.href}
      prefetch={true}
      className={`rail-btn ${p.href === page ? "active" : ""}`}
      aria-label={navT(L, p.label)}
      aria-current={p.href === actual ? "page" : undefined}
      data-tip={navT(L, p.label)}
      onClick={() => setPage(p.href)}
    >
      {p.icon ?? <IconGrid />}
    </Link>
  );
  // 「更多」放在最後一個（設定）前面
  const last = MORE.length && PAGES.length ? PAGES[PAGES.length - 1] : null;
  return (
    <nav className="rail-group page-nav" aria-label={L("主要頁面", "Main pages")}>
      {(last ? PAGES.slice(0, -1) : PAGES).map(link)}
      {MORE.length > 0 && (
        <div className="rail-more">
          <button type="button" className={`rail-btn ${MORE.some((p) => p.href === page) ? "active" : ""}`} aria-label={L("更多", "More")} aria-expanded={open} aria-haspopup="menu" data-tip={open ? undefined : L("更多", "More")} onClick={() => setOpen(!open)}>
            <IconDots />
          </button>
          {open && (
            <div className="rail-more-menu glass" role="menu">
              {MORE.map((p) => (
                <Link key={p.href} href={p.href} role="menuitem" className={`menu-item ${p.href === page ? "active" : ""}`} onClick={() => { setPage(p.href); setOpen(false); }}>
                  {p.icon ?? <IconGrid />} {navT(L, p.label)}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      {last && link(last)}
    </nav>
  );
}

type RailItem = { key: string; label: string; icon: React.ReactNode; href?: string };

const CORE_RAIL: Record<string, { def: string; items: RailItem[] }> = {
  "/": {
    def: "all",
    items: [
      { key: "all", label: "全部點子", icon: <IconGrid /> },
      { key: "week", label: "本週", icon: <IconCalendar /> },
      { key: "todo", label: "待補充", icon: <IconAlert /> },
      { key: "adopted", label: "已採用", icon: <IconCheck /> },
      { key: "brief", label: "已選入簡報", icon: <IconClipboard /> },
    ],
  },
  "/grants": {
    def: "all",
    items: [
      { key: "all", label: "全部開放中", icon: <IconGrid /> },
      { key: "soon", label: "30 天內截止", icon: <IconClock /> },
      { key: "rolling", label: "常態受理", icon: <IconInfinity /> },
      { key: "closed", label: "已截止／不適合", icon: <IconArchive /> },
    ],
  },
  "/monitor": {
    def: "all",
    items: [
      { key: "all", label: "全部產品", icon: <IconPulse /> },
    ],
  },
  "/costs": {
    def: "all",
    items: [
      { key: "all", label: "總覽", icon: <IconGrid /> },
      { key: "subs", label: "訂閱", icon: <IconCalendar /> },
      { key: "once", label: "一次性開銷", icon: <IconClipboard /> },
      { key: "ai", label: "AI 用量", icon: <IconSparkle /> },
    ],
  },
  "/projects": {
    def: "cards",
    items: [
      { key: "cards", label: "專案卡片", icon: <IconGrid /> },
      { key: "calendar", label: "月曆", icon: <IconCalendar /> },
    ],
  },
  "/social": {
    def: "week",
    items: [
      { key: "week", label: "一週看板", icon: <IconCalendar /> },
      { key: "posts", label: "排程清單", icon: <IconList /> },
      { key: "audit", label: "成效", icon: <IconTrend /> },
      { key: "swipes", label: "靈感庫", icon: <IconFlame /> },
      { key: "patrol", label: "海巡", icon: <IconSearch /> },
      { key: "engage", label: "互動", icon: <IconChat /> },
      { key: "profile", label: "檔案健檢", icon: <IconUsers /> },
    ],
  },
  "/office": {
    def: "all",
    items: [{ key: "all", label: "整棟大樓", icon: <IconGrid /> }],
  },
  "/settings": {
    def: "desc",
    items: [
      { key: "desc", label: "專案描述", icon: <IconSparkle /> },
      { key: "status", label: "連線狀態", icon: <IconLink /> },
      { key: "theme", label: "外觀", icon: <IconPalette /> },
      { key: "digest", label: "週報", icon: <IconMail /> },
      { key: "learn", label: "AI 學習", icon: <IconBulb /> },
      { key: "app", label: "手機 App", icon: <IconPhone /> },
      { key: "partners", label: "合夥人", icon: <IconUsers /> },
    ],
  },
};

// 模組的檢視：新頁面整組加入，既有頁面（例如 /monitor）接在後面
const RAIL: Record<string, { def: string; server?: boolean; items: RailItem[] }> = (() => {
  const out: Record<string, { def: string; server?: boolean; items: RailItem[] }> = Object.fromEntries(Object.entries(CORE_RAIL).map(([k, v]) => [k, { ...v, items: [...v.items] }]));
  for (const [page, r] of metaModules.flatMap((m) => Object.entries(m.rails ?? {}))) {
    const items = r.items.map((it) => ({ key: it.key, label: it.label, icon: it.icon, href: it.href }));
    if (out[page]) {
      out[page].items.push(...items);
      if (r.server) out[page].server = true;
    } else out[page] = { def: r.def ?? items[0]?.key ?? "all", server: r.server, items };
  }
  return out;
})();

/** 頂部列的檢視切換：頁面內的檢視（手機版是上方可左右滑的小分段）。
 *  在同一頁切換檢視時只改網址、不向伺服器重新要資料，畫面瞬間切換。 */
/** room＝這個專案在辦公室有房間（填了資料夾名稱） */
export type RailProject = { id?: string; slug: string; name: string; color: string; room?: boolean };

/** 合夥人在專案頁只看得到有權限的檢視（卡片／月曆） */
function railFor(page: string, a: Access) {
  const rail = RAIL[page] ?? { def: "all", items: [] };
  if (a.owner || page === "/grants" || page === "/social") return rail;
  // 點子庫：合夥人看的是簡單清單，沒有檢視可切；監控：只看「全部」（他看不到其他產品）
  if (page === "/") return { def: "all", items: [] };
  // 模組頁面的檢視有各自勾選的：只留勾了的，預設是第一個
  const views = memberViews(a, page, rail.def);
  if (views) {
    const items = rail.items.filter((it) => views.includes(it.key));
    return { ...rail, def: items[0]?.key ?? rail.def, items };
  }
  if (page !== "/projects") return { def: "all", items: rail.items.filter((it) => it.key === "all") };
  const items = rail.items.filter((it) => (it.key === "calendar" ? can(a, "calendar") : can(a, "projects")));
  return { def: items.some((it) => it.key === rail.def) ? rail.def : items[0]?.key ?? rail.def, items };
}

export function SideRail({ children, projects = [] }: { children?: React.ReactNode; projects?: RailProject[] }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const a = useAccess();
  const slugs = projects.map((p) => p.slug);
  const page = currentPage(pathname, { a, slugs });
  const toolOf = toolProject(pathname, a, slugs); // 在某個專案自己的工具頁：下面那排專案捷徑亮那個專案
  const rail = railFor(page, a);
  const L = useL();
  const onBase = pathname === page; // 例如在 /design/brief 時就不是
  const view = !onBase && pathname.startsWith("/design/brief") ? "brief" : !onBase ? "" : (sp.get("view") ?? rail.def);

  const hrefFor = (v: string) => {
    const p = new URLSearchParams(onBase ? sp.toString() : "");
    p.delete("msg");
    p.delete("room"); // 辦公室：按檢視就回到整棟大樓
    if (v === rail.def) p.delete("view");
    else p.set("view", v);
    const s = p.toString();
    return s ? `${page}?${s}` : page;
  };

  return (
    <aside className="rail" aria-label={L("檢視", "Views")}>
      <div className="rail-group">
        {rail.items.map((it) => {
          const linked = it.href; // 連到另一個網址的項目：照一般換頁走
          const href = linked ?? hrefFor(it.key);
          const active = linked ? pathname === linked || pathname.startsWith(linked + "/") : it.key === view && !(page === "/office" && onBase && sp.get("room"));
          return (
            <Link
              key={it.key}
              href={href}
              prefetch={false} // 同一頁切換不需要向伺服器預先載入
              onClick={(e) => {
                // 從其他頁過來、或這頁的檢視要伺服器重新準備資料（模組的頁面可以這樣設定）時走一般換頁；
                // 只改網址的話伺服器不會重給畫面，會變成「按了網址有變、畫面沒切」
                if (linked || !onBase || rail.server) return;
                e.preventDefault();
                if (!active) window.history.pushState(null, "", href);
              }}
              className={`rail-btn ${active ? "active" : ""}`}
              aria-label={navT(L, it.label)}
              aria-current={active ? "true" : undefined}
              data-tip={navT(L, it.label)}
            >
              {it.icon}
              <span className="rail-label">{navT(L, it.label)}</span>
            </Link>
          );
        })}
      </div>
      {/* 專案頁：每個專案的詳細頁；辦公室：切到那個專案的房間（只列有房間的專案，同一頁切換只改網址） */}
      {(page === "/projects" || page === "/office") && projects.some((p) => page !== "/office" || p.room) && (
        <div className="rail-group rail-projects">
          {projects.filter((p) => page !== "/office" || p.room).map((p) => {
            const office = page === "/office";
            const href = office ? `/office?room=${p.slug}` : `/projects/${p.slug}`;
            const active = office ? onBase && sp.get("room") === p.slug : pathname === href || toolOf === p.slug;
            return (
              <Link
                key={p.slug}
                href={href}
                prefetch={office ? false : undefined}
                onClick={(e) => {
                  if (!office || !onBase) return;
                  e.preventDefault();
                  if (!active) window.history.pushState(null, "", href);
                }}
                className={`rail-btn ${active ? "active" : ""}`}
                aria-label={p.name}
                aria-current={active ? "page" : undefined}
                data-tip={p.name}
              >
                <span className="rail-proj" style={{ background: p.color }} aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
                <span className="rail-label">{p.name}</span>
              </Link>
            );
          })}
        </div>
      )}
      {children}
    </aside>
  );
}

/** 專案自己的工具頁：這一頁的檢視（例如未處理／嚴重…）排在專案分頁下面。
 *  頂部列那一排在這種頁面是「專案」的檢視，所以工具自己的放這裡；同一頁切換只改網址。 */
export function ToolViews({ page }: { page: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const L = useL();
  const rail = RAIL[page];
  if (!rail || pathname !== page) return null;
  const view = sp.get("view") ?? rail.def;
  return (
    <nav className="pd-sub" aria-label={L("檢視", "Views")}>
      {rail.items.map((it) => {
        const q = new URLSearchParams(sp.toString());
        q.delete("msg");
        if (it.key === rail.def) q.delete("view");
        else q.set("view", it.key);
        const href = q.toString() ? `${page}?${q}` : page;
        const active = it.key === view;
        return (
          <Link
            key={it.key}
            href={href}
            prefetch={false}
            className={active ? "active" : ""}
            aria-current={active ? "true" : undefined}
            onClick={(e) => {
              if (rail.server) return;
              e.preventDefault();
              if (!active) window.history.pushState(null, "", href);
            }}
          >
            {navT(L, it.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** 頁面內容讀取目前檢視（跟頂部列的檢視切換同步） */
export function useView(def: string, allowed: readonly string[]): string {
  const sp = useSearchParams();
  const v = sp.get("view") ?? def;
  return allowed.includes(v) ? v : def;
}

// ---------- 主題 ----------

type Theme = "fluento" | "ember" | "portal" | "mono";
type Mode = "light" | "dark";

function readAttr<T extends string>(name: "theme" | "mode", fallback: T): T {
  if (typeof document === "undefined") return fallback;
  return (document.documentElement.dataset[name] as T) || fallback;
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 無痕模式等情況存不了，不影響使用 */
  }
}

// 手機 App 跟著網頁的主題：切換時存到伺服器；打開網頁時也補存一次（這個功能上線前選好的主題）
let appThemeSynced = false;
function syncAppTheme(next: { theme?: Theme; mode?: Mode } = {}) {
  appThemeSynced = true;
  // 過場動畫裡才寫進畫面，所以剛切換的那一項直接用新值
  saveUiTheme(next.theme ?? readAttr("theme", "fluento"), next.mode ?? readAttr("mode", "light")).catch(() => null);
}

function useThemeState() {
  const [theme, setTheme] = useState<Theme>("fluento");
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    if (!appThemeSynced) syncAppTheme();
  }, []);
  useEffect(() => {
    const sync = () => {
      setTheme(readAttr("theme", "fluento"));
      setMode(readAttr("mode", "light"));
    };
    sync();
    // 同一頁有多個切換器時（例如設定頁），彼此保持同步
    window.addEventListener("ib-theme-change", sync);
    return () => window.removeEventListener("ib-theme-change", sync);
  }, []);
  // 主題：整頁交叉淡入＋色帶流動；深淺色：從按下的按鈕擴散成圓形
  const applyTheme = (t: Theme) => {
    if (readAttr("theme", "fluento") === t) return;
    withViewTransition("theme", () => {
      document.documentElement.dataset.theme = t;
      save("ib-theme", t);
      window.dispatchEvent(new Event("ib-theme-change"));
    });
    syncAppTheme({ theme: t });
  };
  const applyMode = (m: Mode, e?: React.MouseEvent<HTMLElement>) => {
    if (readAttr("mode", "light") === m) return;
    withViewTransition(
      "mode",
      () => {
        document.documentElement.dataset.mode = m;
        save("ib-mode", m);
        window.dispatchEvent(new Event("ib-theme-change"));
      },
      e?.currentTarget,
    );
    syncAppTheme({ mode: m });
  };
  return { theme, mode, applyTheme, applyMode };
}

/** 淺色／深色切換（左側圖示列下方） */
export function ModeToggle() {
  const { mode, applyMode } = useThemeState();
  const L = useL();
  return (
    <div className="rail-group rail-mode">
      <button type="button" className={`rail-btn ${mode === "light" ? "active" : ""}`} onClick={(e) => applyMode("light", e)} aria-label={L("淺色", "Light")} data-tip={L("淺色", "Light")}>
        <IconSun />
      </button>
      <button type="button" className={`rail-btn ${mode === "dark" ? "active" : ""}`} onClick={(e) => applyMode("dark", e)} aria-label={L("深色", "Dark")} data-tip={L("深色", "Dark")}>
        <IconMoon />
      </button>
    </div>
  );
}

/** 主題色切換膠囊（Mono 排第一個；名稱都用英文，不跟語言換） */
export function ThemeSwitch({ inline = false }: { inline?: boolean }) {
  const { theme, applyTheme } = useThemeState();
  const L = useL();
  return (
    <div className={`theme-switch ${inline ? "inline" : ""}`} role="radiogroup" aria-label={L("主題色", "Theme")}>
      <button type="button" role="radio" aria-checked={theme === "mono"} className={theme === "mono" ? "active" : ""} onClick={() => applyTheme("mono")}>
        <span className="dot mono" /> Mono
      </button>
      <button type="button" role="radio" aria-checked={theme === "fluento"} className={theme === "fluento" ? "active" : ""} onClick={() => applyTheme("fluento")}>
        <span className="dot fluento" /> Fluento
      </button>
      <button type="button" role="radio" aria-checked={theme === "ember"} className={theme === "ember" ? "active" : ""} onClick={() => applyTheme("ember")}>
        <span className="dot ember" /> Ember
      </button>
      <button type="button" role="radio" aria-checked={theme === "portal"} className={theme === "portal" ? "active" : ""} onClick={() => applyTheme("portal")}>
        <span className="dot portal" /> Portal
      </button>
    </div>
  );
}

/** 設定頁用的完整外觀控制（手機版主要入口） */
export function AppearanceControls() {
  const { mode, applyMode } = useThemeState();
  const L = useL();
  return (
    <div className="appearance">
      <LangSwitch />
      <ThemeSwitch inline />
      <div className="theme-switch inline" role="radiogroup" aria-label={L("淺色或深色", "Light or dark")}>
        <button type="button" role="radio" aria-checked={mode === "light"} className={mode === "light" ? "active" : ""} onClick={(e) => applyMode("light", e)}>
          <IconSun size={15} /> {L("淺色", "Light")}
        </button>
        <button type="button" role="radio" aria-checked={mode === "dark"} className={mode === "dark" ? "active" : ""} onClick={(e) => applyMode("dark", e)}>
          <IconMoon size={15} /> {L("深色", "Dark")}
        </button>
      </div>
    </div>
  );
}

/** 底部主題膠囊：滑鼠移到畫面最下方 90px 內才顯示 */
export function ThemeDock() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setShow(window.innerHeight - e.clientY < 90));
    };
    const onLeave = () => setShow(false);
    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return (
    <div className={`theme-dock ${show ? "show" : ""}`}>
      <ThemeSwitch />
    </div>
  );
}
