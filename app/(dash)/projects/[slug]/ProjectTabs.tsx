"use client";

import Link from "next/link";
import { useL } from "@/app/LangProvider";

import type { TabDef } from "@/lib/projectTabs";
export type { TabDef };

/** 專案詳細頁的分頁列：總覽（原本的內容）、發文排程（連到社群助手，標 ↗）…、這個專案自己的工具（模組加的；工具頁上面也是這一排） */
export function ProjectTabs({ slug, tabs, active }: { slug: string; tabs: TabDef[]; active: string }) {
  const L = useL();
  return (
    <nav className="pd-tabs" aria-label={L("專案分頁", "Project tabs")}>
      {tabs.map((t) => (
        <Link key={t.key || "overview"} href={t.href ?? (t.key ? `/projects/${slug}?tab=${t.key}` : `/projects/${slug}`)} className={t.key === active ? "active" : ""} aria-current={t.key === active ? "page" : undefined} scroll={false}>
          {L(...t.label)}{t.href && !t.tool ? " ↗" : ""}
          {t.count ? <span className="pd-tab-n">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
