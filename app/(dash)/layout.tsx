import Link from "next/link";
import { Suspense } from "react";
import { requireViewer } from "@/lib/auth";
import { can, seesProject, type Access } from "@/lib/accessLogic";
import { AccessProvider } from "./AccessContext";
import { getL } from "@/lib/i18nServer";
import { taipeiDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { logout } from "../login/actions";
import { AccountMenu, BellMenu, type BellItem } from "./BellMenu";
import { MobileTabBar } from "./MobileTabBar";
import { LogoMark } from "../LogoMark";
import { IconBell, IconSearch } from "./icons";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { ModeToggle, PageName, SideRail, ThemeDock, TopNav, type RailProject } from "./Nav";
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

/** 頂部列的專案捷徑（顏色跟專案頁一樣照順序）；還沒執行 migration-012 時是空的 */
async function railProjects(access: Access): Promise<RailProject[]> {
  if (!can(access, "projects")) return []; // 只開月曆的合夥人進不了專案詳細頁
  const { data, error } = await db().from("projects").select("id, slug, name, status").order("sort", { ascending: true });
  if (error || !data) return [];
  const palette = Object.values(FOLDER_COLORS);
  // 顏色照全部專案的順序（合夥人看到的顏色跟你一樣），再過濾看得到的
  return (data as { id: string; slug: string; name: string; status: string }[])
    .map((p, i) => ({ id: p.id, slug: p.slug, name: p.name, status: p.status, color: palette[i % palette.length] }))
    .filter((p) => p.status !== "done" && seesProject(access, p.id))
    .map(({ slug, name, color }) => ({ slug, name, color }));
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  // 登入驗證與待處理數量同時進行，縮短等待
  const { email, access } = await requireViewer();
  const [counts, projects] = await Promise.all([
    // 合夥人不顯示通知鈴的數字（那是你的待辦）
    access.owner ? pendingCounts().catch(() => ({ ideas: 0, grants: 0, monitor: 0 })) : { ideas: 0, grants: 0, monitor: 0 },
    railProjects(access).catch(() => []),
  ]);
  const extra = access.owner ? modules().flatMap((m) => m.bell ?? []) : [];
  const extraCounts = await Promise.all(extra.map((b) => b.count().catch(() => 0)));
  const L = await getL();
  const allBell: BellItem[] = [
    { key: "monitor", label: L("服務異常", "Services down"), hint: L("產品監控裡連不上的服務", "Monitored services that are unreachable"), count: counts.monitor, href: "/monitor", tone: "danger" },
    ...extra.map((b, i) => ({ key: b.key, label: L(...b.label), hint: L(...b.hint), count: extraCounts[i], href: b.href, tone: b.tone })),
    { key: "ideas", label: L("點子待補充", "Ideas needing input"), hint: L("抓不到內容或分析失敗", "Content missing or analysis failed"), count: counts.ideas, href: "/?view=todo", tone: "warn" },
    { key: "grants", label: L("補助快截止", "Grants closing soon"), hint: L("14 天內截止、還沒處理", "Due within 14 days, not handled yet"), count: counts.grants, href: "/grants?view=soon", tone: "warn" },
  ];
  const bell = access.owner ? allBell : [];

  return (
    <AccessProvider access={access}>
    <div className="app-bg">
      {/* Portal 主題的背景圖放在獨立的固定圖層（其他主題不顯示），換頁、畫面有動畫時不用重畫背景 */}
      <div className="pt-bg" aria-hidden />
      <div className="shell">
      {/* 左側圖示列：頁面（手機版不顯示，改用底部分頁列） */}
      <aside className="page-rail" aria-label={L("頁面", "Pages")}>
        <Link href="/" className="logo" aria-label={L("ideabox 首頁", "ideabox home")}>
          <LogoMark size={22} />
        </Link>
        <Suspense fallback={<nav className="rail-group page-nav" />}>
          <TopNav />
        </Suspense>
        <ModeToggle />
      </aside>
      <div className="frame">
        {/* 頂部列：頁面名稱＋這一頁的檢視切換＋搜尋、通知、帳號（手機版只留檢視切換） */}
        <header className="topbar">
          <Suspense fallback={<h1 className="page-name" />}>
            <PageName />
          </Suspense>
          <Suspense fallback={<aside className="rail" />}>
            <SideRail projects={projects} />
          </Suspense>
          <div className="top-actions">
            {access.owner && (
              <Link href="/#search" className="circle-btn hide-sm" aria-label={L("搜尋點子", "Search ideas")}>
                <IconSearch size={17} />
              </Link>
            )}
            <Suspense fallback={<span className="circle-btn" aria-hidden><IconBell size={17} /></span>}>
              <BellMenu items={bell} />
            </Suspense>
            <AccountMenu email={access.owner ? email : `${access.name}・${email}`} logout={logout} />
          </div>
        </header>

        <div className="frame-body">
          <main className="main-area">{children}</main>
        </div>
      </div>
      </div>
      <ThemeDock />
      <MobileTabBar items={bell} logout={logout} />
      <Suspense fallback={null}>
        <PortalFx />
      </Suspense>
    </div>
    </AccessProvider>
  );
}
