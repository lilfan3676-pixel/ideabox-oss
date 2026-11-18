import { Suspense } from "react";
import { requirePage } from "@/lib/auth";
import { productsFor, seesProject } from "@/lib/accessLogic";
import { db } from "@/lib/db";
import { getL } from "@/lib/i18nServer";
import { readHealth } from "@/lib/health";
import { monitorProducts } from "@/lib/monitor";
import { listProjects } from "@/lib/projects";
import type { StatusRow } from "@/lib/monitorLogic";
import { MonitorView, type DailyRow } from "./MonitorView";

export const dynamic = "force-dynamic";

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { access } = await requirePage("monitor");
  const { msg } = await searchParams;
  const L = await getL();
  const since = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: status, error }, { data: daily }, health, products, { projects }] = await Promise.all([
    db().from("monitor_status").select("*"),
    db().from("monitor_daily").select("*").gte("day", since).order("day"),
    readHealth().catch(() => null),
    monitorProducts(),
    listProjects().catch(() => ({ projects: [] as { id: string; slug: string; name: string }[] })),
  ]);
  // 合夥人只看他專案的產品（系統健康、加網址、立即檢查只有你有）
  const mineProjects = projects.filter((p) => seesProject(access, p.id));
  const shown = productsFor(access, mineProjects.map((p) => p.slug), products);
  const keys = new Set(shown.map((p) => p.key));
  const mine = <T extends { product: string }>(rows: T[]) => (access.owner ? rows : rows.filter((r) => keys.has(r.product)));

  return (
    <>
      {error && <p className="error">{L("讀取監控資料失敗，可能還沒在 ideabox 的 Supabase 執行 migration-004-monitor.sql。", "Couldn't load monitor data. migration-004-monitor.sql may not have been run on the ideabox Supabase yet.")}</p>}
      <Suspense>
        <MonitorView
          status={mine((status ?? []) as StatusRow[])}
          daily={mine((daily ?? []) as DailyRow[])}
          products={shown}
          projects={mineProjects.map((p) => ({ slug: p.slug, name: p.name }))}
          health={access.owner ? health : null}
          now={Date.now()}
          msg={msg}
        />
      </Suspense>
    </>
  );
}
