import "server-only";
import { randomBytes } from "node:crypto";
import { taipeiDate } from "./dates";
import { db } from "./db";
import { sendPushSafe } from "./app";
import { modules } from "./modules/registry";
import type { MonitorOutcome, MonitorProduct } from "./modules/types";
import { checkSite, timed } from "./monitorCheck";
import { DB_WARN_RATIO, durationText, formatBytes, nextStatus, siteKey, type StatusRow } from "./monitorLogic";
import { esc, sendToOwner } from "./telegram";

// 產品監控：
// - 通用：在監控頁加網址（存在 settings.monitor_sites），每 5 分鐘檢查網站有沒有活著
// - 模組：自己的產品可以寫成模組（lib/modules），回報更多服務與使用者數字

export type Site = { id: string; name: string; url: string; slug?: string | null };
const SITES_KEY = "monitor_sites";

export async function listSites(): Promise<Site[]> {
  const { data } = await db().from("settings").select("value").eq("key", SITES_KEY).maybeSingle();
  try {
    const list = JSON.parse((data as { value: string } | null)?.value ?? "[]") as Site[];
    return Array.isArray(list) ? list.filter((s) => s && s.id && s.url) : [];
  } catch {
    return [];
  }
}

async function saveSites(list: Site[]) {
  await db().from("settings").upsert({ key: SITES_KEY, value: JSON.stringify(list), updated_at: new Date().toISOString() });
}

export async function addSite(site: Omit<Site, "id">): Promise<Site> {
  const list = await listSites();
  const s: Site = { id: randomBytes(4).toString("hex"), name: site.name.slice(0, 40), url: site.url, slug: site.slug || null };
  await saveSites([...list, s]);
  return s;
}

export async function removeSite(id: string) {
  const list = await listSites();
  await saveSites(list.filter((s) => s.id !== id));
  await db().from("monitor_status").delete().eq("product", siteKey(id));
}

function siteProduct(s: Site): MonitorProduct {
  return {
    key: siteKey(s.id),
    label: s.name,
    services: [{ id: siteKey(s.id), zh: "網站", en: "Website" }],
    slugs: s.slug ? [s.slug] : [],
    site: { id: s.id, url: s.url },
  };
}

/** 全部監控中的產品（模組的在前、網址監控在後） */
export async function monitorProducts(): Promise<MonitorProduct[]> {
  const sites = await listSites().catch(() => []);
  return [...modules().flatMap((m) => m.monitor?.products() ?? []), ...sites.map(siteProduct)];
}

async function runChecks(sites: Site[]): Promise<MonitorOutcome[]> {
  const jobs: Promise<MonitorOutcome[]>[] = modules().map((m) => (m.monitor ? m.monitor.run().catch(() => []) : Promise.resolve([])));
  for (const s of sites) {
    jobs.push(
      (async () => {
        const { result } = await timed(() => checkSite(s.url));
        return [{ service: siteKey(s.id), product: siteKey(s.id), result }];
      })(),
    );
  }
  return (await Promise.all(jobs)).flat();
}

/** 執行一次全部檢查：更新狀態、記錄今天的數字、需要時傳 Telegram */
export async function runMonitor(opts: { notify: boolean }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const today = taipeiDate(now);
  const sites = await listSites().catch(() => []);
  const products = [...modules().flatMap((m) => m.monitor?.products() ?? []), ...sites.map(siteProduct)];
  const outcomes = await runChecks(sites);
  const productOf = new Map(products.map((p) => [p.key, p]));
  const serviceName = (o: MonitorOutcome) => {
    const p = productOf.get(o.product);
    const svc = p?.services.find((x) => x.id === o.service)?.zh ?? o.service;
    return `${p?.label ?? o.product}・${svc}`;
  };

  const { data: prevRows } = await db().from("monitor_status").select("*");
  const prev = new Map(((prevRows ?? []) as StatusRow[]).map((r) => [r.service, r]));
  const messages: string[] = [];
  const pushes: { title: string; body: string }[] = []; // 手機 App 只推掛掉／恢復
  const rows: StatusRow[] = [];

  for (const o of outcomes) {
    const { row, event, downSince } = nextStatus(prev.get(o.service) ?? null, o.service, o.product, o.result, nowIso);
    const name = serviceName(o);
    if (event === "down") {
      messages.push(`🔴 <b>${esc(name)}</b> 連不上\n原因：${esc(row.last_error ?? "沒有回應")}`);
      pushes.push({ title: `🔴 ${name} 連不上`, body: `原因：${row.last_error ?? "沒有回應"}` });
    } else if (event === "up") {
      const dur = downSince ? `（中斷約 ${durationText(now.getTime() - new Date(downSince).getTime())}）` : "";
      messages.push(`🟢 <b>${esc(name)}</b> 已恢復正常${dur}`);
      pushes.push({ title: `🟢 ${name} 已恢復正常`, body: dur ? dur.replace(/[（）]/g, "") : "服務已經恢復" });
    }

    if (o.stats) {
      await db().from("monitor_daily").upsert({ product: o.product, day: today, ...o.stats, updated_at: nowIso });
      // 資料庫用量超過 80% 時提醒（一天最多一次）
      const limit = productOf.get(o.product)?.dbLimitBytes;
      if (limit && o.stats.db_bytes >= limit * DB_WARN_RATIO && row.warned_on !== today) {
        row.warned_on = today;
        const pct = Math.round((o.stats.db_bytes / limit) * 100);
        const label = productOf.get(o.product)?.label ?? o.product;
        messages.push(`🟠 <b>${esc(label)} 資料庫用量 ${pct}%</b>\n${formatBytes(o.stats.db_bytes)}／${formatBytes(limit)}，接近方案上限。`);
      }
    }
    rows.push(row);
  }

  if (rows.length) await db().from("monitor_status").upsert(rows);
  if (opts.notify && messages.length) await sendToOwner(messages.join("\n\n")).catch(() => null);
  if (opts.notify) for (const m of pushes) await sendPushSafe({ ...m, data: { screen: "today" } });
  return { checked: outcomes.length, down: rows.filter((r) => !r.ok).length, notified: opts.notify ? messages.length : 0 };
}
