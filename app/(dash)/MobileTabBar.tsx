"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useL } from "../LangProvider";
import type { BellItem } from "./BellMenu";
import { IconBell, IconBox, IconGrid, IconLogout, IconPulse } from "./icons";
import { ALL_PAGES, AppearanceControls } from "./Nav";
import { metaModules } from "@/lib/modules/meta";

const MOBILE = "(max-width: 720px)";

/**
 * 手機簡易版的底部分頁列：兩個常用分頁（預設監控、專案；模組可以換掉）、通知、更多。
 * 只在螢幕寬度 720px 以下顯示（CSS 控制）；其他頁面收在「更多」裡。
 */
export function MobileTabBar({ items, logout }: { items: BellItem[]; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const router = useRouter();
  const L = useL();
  const [sheet, setSheet] = useState<"bell" | "more" | null>(null);
  const total = items.reduce((a, i) => a + i.count, 0);

  // 手機第一次打開網站時直接到「監控」（之後在「更多」點點子庫仍可正常進入）
  useEffect(() => {
    if (pathname !== "/" || !window.matchMedia(MOBILE).matches) return;
    try {
      if (sessionStorage.getItem("ib-m-home")) return;
      sessionStorage.setItem("ib-m-home", "1");
    } catch {
      return;
    }
    router.replace("/monitor");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setSheet(null), [pathname]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);

  const tab = (href: string, label: string, icon: React.ReactNode) => {
    const active = pathname.startsWith(href);
    return (
      <Link href={href} className={`m-tab ${active && !sheet ? "active" : ""}`} aria-current={active ? "page" : undefined}>
        {icon}
        <span>{label}</span>
      </Link>
    );
  };

  // 「更多」選單：底部分頁列以外的頁面
  const MORE = ALL_PAGES.filter(([href]) => href !== "/monitor");
  const TABS = metaModules.find((m) => m.mobileTabs?.length)?.mobileTabs ?? [
    { href: "/monitor", label: "監控", en: "Monitor", icon: <IconPulse size={22} /> },
    { href: "/projects", label: "專案", en: "Projects", icon: <IconBox size={22} /> },
  ];

  return (
    <>
      <nav className="m-tabbar" aria-label={L("手機分頁", "Tabs")}>
        {TABS.slice(0, 2).map((t) => <span key={t.href} style={{ display: "contents" }}>{tab(t.href, L(t.label, t.en), t.icon)}</span>)}
        <button type="button" className={`m-tab ${sheet === "bell" ? "active" : ""}`} onClick={() => setSheet(sheet === "bell" ? null : "bell")}>
          <span className="m-badge-wrap">
            <IconBell size={22} />
            {total > 0 && <span className="bell-dot">{total > 9 ? "9+" : total}</span>}
          </span>
          <span>{L("通知", "Alerts")}</span>
        </button>
        <button type="button" className={`m-tab ${sheet === "more" ? "active" : ""}`} onClick={() => setSheet(sheet === "more" ? null : "more")}>
          <IconGrid size={22} />
          <span>{L("更多", "More")}</span>
        </button>
      </nav>

      {sheet && (
        <div className="m-sheet-root" onClick={() => setSheet(null)}>
          <div className="m-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span className="drawer-grip" aria-hidden />
            {sheet === "bell" ? (
              <>
                <h3>{L("待處理", "To do")}</h3>
                {items.map((i) => (
                  <Link key={i.key} href={i.href} className={`bell-row ${i.count ? "" : "zero"}`} onClick={() => setSheet(null)}>
                    <span className="bell-text">
                      <b>{i.label}</b>
                      <span className="muted small">{i.hint}</span>
                    </span>
                    <span className={`bell-count ${i.count ? i.tone : ""}`}>{i.count}</span>
                  </Link>
                ))}
              </>
            ) : (
              <>
                <h3>{L("更多", "More")}</h3>
                <div className="m-more-grid">
                  {MORE.map(([href, zh, en]) => (
                    <Link key={href} href={href} onClick={() => setSheet(null)} className={`m-more-item ${pathname === href || (href !== "/" && pathname.startsWith(href)) ? "active" : ""}`}>
                      {L(zh, en)}
                    </Link>
                  ))}
                </div>
                <div className="m-more-section">
                  <AppearanceControls />
                </div>
                <form action={logout}>
                  <button type="submit" className="menu-item">
                    <IconLogout size={16} /> {L("登出", "Log out")}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
