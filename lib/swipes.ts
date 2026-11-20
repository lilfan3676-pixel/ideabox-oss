import "server-only";
import { db } from "./db";
import type { RadarPost } from "./radarLogic";
import { classifyHook, cleanSwipe, firstSentence, type Swipe, type SwipeInput } from "./swipeLogic";

// 爆款靈感庫：同領域爆紅貼文的開頭。自己貼的，或話題雷達每週自動存的熱門貼文。資料表 social_swipes（migration-031）。

/** ready=false 代表還沒執行 migration-031 */
export async function listSwipes(projectIds?: string[]): Promise<{ swipes: Swipe[]; ready: boolean }> {
  let q = db().from("social_swipes").select("*");
  if (projectIds) q = q.in("project_id", projectIds.length ? projectIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
  if (error) return { swipes: [], ready: false };
  return { swipes: (data ?? []) as Swipe[], ready: true };
}

export async function getSwipe(id: string): Promise<Swipe | null> {
  const { data } = await db().from("social_swipes").select("*").eq("id", id).maybeSingle();
  return (data as Swipe | null) ?? null;
}

export async function addSwipe(projectId: string, v: SwipeInput): Promise<{ swipe?: Swipe; error?: string }> {
  const r = cleanSwipe(v);
  if ("error" in r) return { error: r.error };
  const { data, error } = await db().from("social_swipes").insert({ ...r.row, project_id: projectId, source: "manual" }).select().single();
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "這個連結已經存過了" : "存不進去：請先在 ideabox 的 Supabase 執行 migration-031-social-plan.sql" };
  return { swipe: data as Swipe };
}

export async function deleteSwipe(id: string): Promise<void> {
  await db().from("social_swipes").delete().eq("id", id);
}

/** 話題雷達抓完後：這週讚數最高的幾篇自動存進靈感庫（同一個連結不重複；沒有這張表就安靜略過） */
export async function saveRadarSwipes(projectId: string, posts: RadarPost[], max = 5): Promise<number> {
  const top = [...posts].filter((p) => p.url && p.likes > 0 && p.text.trim().length >= 8).sort((a, b) => b.likes - a.likes).slice(0, max);
  if (!top.length) return 0;
  const { data: had, error } = await db().from("social_swipes").select("url").eq("project_id", projectId).in("url", top.map((p) => p.url));
  if (error) return 0;
  const seen = new Set(((had ?? []) as { url: string }[]).map((r) => r.url));
  const rows = top
    .filter((p) => !seen.has(p.url))
    .map((p) => {
      const hook = firstSentence(p.text);
      return { project_id: projectId, account: p.author ? `@${p.author.replace(/^@+/, "")}` : "", hook, url: p.url, likes: p.likes, formula: classifyHook(hook), source: "radar" as const };
    })
    .filter((r) => r.hook.length >= 4);
  if (!rows.length) return 0;
  const res = await db().from("social_swipes").insert(rows);
  return res.error ? 0 : rows.length;
}
