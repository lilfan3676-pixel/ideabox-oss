import Link from "next/link";
import { Suspense } from "react";
import { requireOwner } from "@/lib/auth";
import { getL } from "@/lib/i18nServer";
import { taipeiDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { logout } from "../login/actions";
import { AccountMenu, BellMenu, type BellItem } from "./BellMenu";
import { MobileTabBar } from "./MobileTabBar";
import { LogoMark } from "../LogoMark";
import { IconBell, IconSearch } from "./icons";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { ModeToggle, SideRail, ThemeDock, TopNav, type RailProject } from "./Nav";
import { PortalFx } from "./PortalFx";
import { modules } from "@/lib/modules/registry";

export const dynamic = "force-dynamic";

async function pendingCounts() {
  const today = taipeiDate();
  const in14 = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const [ideas, grants, monitor] = await Promise.all([
    db().from("ideas").select("id", { count: "exact", head: true }).in("status", ["needs_input", "failed"]),
    db()
      .from("grants")
      .select("id", { count: "exact", head: true })
      .in("status", ["new", "interested"])
      .gte("deadline", today)
      .lte("deadline", in14),
    db().from("monitor_status").select("service", { count: "exact", head: true }).eq("ok", false),
  ]);
  return { ideas: ideas.count ?? 0, grants: grants.count ?? 0, monitor: monitor.count ?? 0 };
}

/** 左側列的專案捷徑（顏色跟專案頁一樣照順序）；還沒執行 migration-012 時是空的 */
async function railProjects(): Promise<RailProject[]> {
  const { data, error } = await db().from("projects").select("slug, name, status").order("sort", { ascending: true });
  if (error || !data) return [];
  const palette = Object.values(FOLDER_COLORS);
  return (data as { slug: string; name: string; status: string }[])
    .map((p, i) => ({ slug: p.slug, name: p.name, status: p.status, color: palette[i % palette.length] }))
    .filter((p) => p.status !== "done")
    .map(({ slug, name, color }) => ({ slug, name, color }));
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // 登入驗證與待處理數量同時進行，縮短等待
  const [{ email }, counts, projects] = await Promise.all([
    requireOwner(),
    pendingCounts().catch(() => ({ ideas: 0, grants: 0, monitor: 0 })),
    railProjects().catch(() => []),
  ]);
  const extra = modules().flatMap((m) => m.bell ?? []);
  const extraCounts = await Promise.all(extra.map((b) => b.count().catch(() => 0)));
  const L = await getL();
  const bell: BellItem[] = [
    { key: "monitor", label: L("服務異常", "Services down"), hint: L("產品監控裡連不上的服務", "Monitored services that are unreachable"), count: counts.monitor, href: "/monitor", tone: "danger" },
    ...extra.map((b, i) => ({ key: b.key, label: L(...b.label), hint: L(...b.hint), count: extraCounts[i], href: b.href, tone: b.tone })),
    { key: "ideas", label: L("點子待補充", "Ideas needing input"), hint: L("抓不到內容或分析失敗", "Content missing or analysis failed"), count: counts.ideas, href: "/?view=todo", tone: "warn" },
    { key: "grants", label: L("補助快截止", "Grants closing soon"), hint: L("14 天內截止、還沒處理", "Due within 14 days, not handled yet"), count: counts.grants, href: "/grants?view=soon", tone: "warn" },
  ];

  return (
    <div className="app-bg">
      {/* Portal 主題的背景圖放在獨立的固定圖層（其他主題不顯示），換頁、畫面有動畫時不用重畫背景 */}
      <div className="pt-bg" aria-hidden />
      <div className="frame">
        <header className="topbar">
          <Link href="/" className="logo" aria-label={L("ideabox 首頁", "ideabox home")}>
            <LogoMark size={22} />
          </Link>
          <Suspense fallback={<nav className="pill-nav" />}>
            <TopNav />
          </Suspense>
          <div className="top-actions">
            <Link href="/#search" className="circle-btn hide-sm" aria-label={L("搜尋點子", "Search ideas")}>
              <IconSearch size={17} />
            </Link>
            <Suspense fallback={<span className="circle-btn" aria-hidden><IconBell size={17} /></span>}>
              <BellMenu items={bell} />
            </Suspense>
            <AccountMenu email={email} logout={logout} />
          </div>
        </header>

        <div className="frame-body">
          <Suspense fallback={<aside className="rail" />}>
            <SideRail projects={projects}>
              <ModeToggle />
            </SideRail>
          </Suspense>
          <main className="main-area">{children}</main>
        </div>
      </div>
      <ThemeDock />
      <MobileTabBar items={bell} logout={logout} />
      <Suspense fallback={null}>
        <PortalFx />
      </Suspense>
    </div>
  );
}
