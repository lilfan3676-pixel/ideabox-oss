import { Suspense } from "react";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { getL } from "@/lib/i18nServer";
import { readHealth } from "@/lib/health";
import { monitorProducts } from "@/lib/monitor";
import { listProjects } from "@/lib/projects";
import type { StatusRow } from "@/lib/monitorLogic";
import { MonitorView, type DailyRow } from "./MonitorView";

export const dynamic = "force-dynamic";

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireOwner();
  const { msg } = await searchParams;
  const L = await getL();
  const since = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: status, error }, { data: daily }, health, products, { projects }] = await Promise.all([
    db().from("monitor_status").select("*"),
    db().from("monitor_daily").select("*").gte("day", since).order("day"),
    readHealth().catch(() => null),
    monitorProducts(),
    listProjects().catch(() => ({ projects: [] as { slug: string; name: string }[] })),
  ]);

  return (
    <>
      {error && <p className="error">{L("讀取監控資料失敗，可能還沒在 ideabox 的 Supabase 執行 migration-004-monitor.sql。", "Couldn't load monitor data. migration-004-monitor.sql may not have been run on the ideabox Supabase yet.")}</p>}
      <Suspense>
        <MonitorView
          status={(status ?? []) as StatusRow[]}
          daily={(daily ?? []) as DailyRow[]}
          products={products}
          projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
          health={health}
          now={Date.now()}
          msg={msg}
        />
      </Suspense>
    </>
  );
}
