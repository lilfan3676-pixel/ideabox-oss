import { Suspense } from "react";
import { requireOwner } from "@/lib/auth";
import { aiUsageSince, aiUsdSince, getBudgetTotal, getFx, listExpenses, monthStartIso } from "@/lib/costs";
import { taipeiDate } from "@/lib/dates";
import { getL } from "@/lib/i18nServer";
import { firstRecordDay, productOptions, type Expense } from "@/lib/costCalc";
import { listProjects } from "@/lib/projects";
import { CostsView } from "./CostsView";

export const dynamic = "force-dynamic";

export default async function CostsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requireOwner();
  const L = await getL();
  const { msg } = await searchParams;
  const today = taipeiDate();
  const month = today.slice(0, 7);
  // AI 用量：取本月與最近 30 天中較早的起點
  const since = [monthStartIso(month), new Date(Date.now() - 31 * 86_400_000).toISOString()].sort()[0];
  let loadError = "";
  const total = await getBudgetTotal().catch(() => null);
  const [expenses, ai, fx, { projects }] = await Promise.all([
    listExpenses().catch((): Expense[] => {
      loadError = L(
        "讀取成本資料失敗，可能還沒在 ideabox 的 Supabase 執行 migration-007-costs.sql。",
        "Couldn't load cost data. You may not have run migration-007-costs.sql on the ideabox Supabase yet.",
      );
      return [];
    }),
    aiUsageSince(since).catch(() => []),
    getFx(),
    listProjects().catch(() => ({ projects: [] as { slug: string; name: string }[] })),
  ]);
  const products = productOptions(projects, [...expenses.map((e) => e.product), ...ai.map((a) => a.product)]);
  // 起算日 = 成本頁第一筆紀錄那天；AI 用量也從那天開始算
  const budget = total ? { total, start: firstRecordDay(expenses, today) } : null;
  const budgetAiUsd = budget ? await aiUsdSince(budget.start).catch(() => 0) : 0;
  return (
    <>
      {loadError && <p className="error">{loadError}</p>}
      <Suspense>
        <CostsView products={products} expenses={expenses} ai={ai} fx={fx} today={today} msg={msg} budget={budget} budgetAiUsd={budgetAiUsd} />
      </Suspense>
    </>
  );
}
