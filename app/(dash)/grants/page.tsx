import { Suspense } from "react";
import { requirePage } from "@/lib/auth";
import { taipeiDate } from "@/lib/dates";
import { db, type Grant } from "@/lib/db";
import { GrantsView } from "./GrantsView";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 一次載入所有補助，檢視切換在瀏覽器裡即時完成
export default async function GrantsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  await requirePage("grants");
  const { msg } = await searchParams;
  const { data } = await db().from("grants").select("*").order("deadline", { ascending: true, nullsFirst: false }).limit(300);
  return (
    <Suspense>
      <GrantsView all={(data ?? []) as Grant[]} today={taipeiDate()} msg={msg} now={Date.now()} />
    </Suspense>
  );
}
