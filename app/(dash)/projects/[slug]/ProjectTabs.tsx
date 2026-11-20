"use client";

import Link from "next/link";
import { useL } from "@/app/LangProvider";

/** href＝這個分頁其實在別的頁面（例如發文排程在社群助手），點了直接過去 */
export type TabDef = { key: string; label: [string, string]; count?: number; href?: string };

/** 專案詳細頁的分頁列：總覽（原本的內容）、發文排程（連到社群助手）…（模組可以再加自己的分頁） */
export function ProjectTabs({ slug, tabs, active }: { slug: string; tabs: TabDef[]; active: string }) {
  const L = useL();
  return (
    <nav className="pd-tabs" aria-label={L("專案分頁", "Project tabs")}>
      {tabs.map((t) => (
        <Link key={t.key || "overview"} href={t.href ?? (t.key ? `/projects/${slug}?tab=${t.key}` : `/projects/${slug}`)} className={t.key === active ? "active" : ""} aria-current={t.key === active ? "page" : undefined} scroll={false}>
          {L(...t.label)}{t.href ? " ↗" : ""}
          {t.count ? <span className="pd-tab-n">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
