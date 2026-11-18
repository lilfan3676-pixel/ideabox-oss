"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useL, useLang } from "@/app/LangProvider";
import { taipeiShort } from "@/lib/format";
import { DB_WARN_RATIO, durationText, formatBytes, type Product, type StatusRow } from "@/lib/monitorLogic";
import type { MonitorProduct } from "@/lib/modules/types";
import type { HealthReport } from "@/lib/healthLogic";
import { addMonitorSite, removeMonitorSite, runHealthNow, runMonitorNow } from "../actions";
import { ConfirmButton, SubmitButton } from "../ConfirmButton";
import { useView } from "../Nav";
import { useAccess } from "../AccessContext";
import { BarRow, Kpi, KpiRow, SidePanel } from "../Insight";

export type DailyRow = { product: Product; day: string; users: number | null; active7: number | null; new7: number | null; db_bytes: number | null };

const STALE_MS = 20 * 60_000; // 超過 20 分鐘沒檢查，代表 5 分鐘排程可能沒在跑

export function MonitorView({
  status,
  daily,
  products: all,
  projects = [],
  health,
  now,
  msg,
}: {
  status: StatusRow[];
  daily: DailyRow[];
  products: MonitorProduct[];
  projects?: { slug: string; name: string }[];
  health: HealthReport | null;
  now: number;
  msg?: string;
}) {
  const view = useView("all", ["all", ...all.map((p) => p.key)]);
  const router = useRouter();
  const L = useL();
  const owner = useAccess().owner;
  // 停在這頁時每分鐘更新一次
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);

  const byService = new Map(status.map((s) => [s.service, s]));
  const products = view === "all" ? all : all.filter((p) => p.key === view);
  const down = status.filter((s) => !s.ok).length;
  const lastCheck = status.reduce<string | null>((a, s) => (s.checked_at && (!a || s.checked_at > a) ? s.checked_at : a), null);
  const stale = !lastCheck || now - new Date(lastCheck).getTime() > STALE_MS;
  // 最上面那排重點數字與右欄（電腦版）：只用現在有的資料（目前狀態、回應時間、每天的使用數字）
  const timed = all
    .flatMap((p) => p.services.map((sv) => ({ id: sv.id, name: `${p.label}・${L(sv.zh, sv.en)}`, row: byService.get(sv.id) })))
    .filter((s): s is { id: string; name: string; row: StatusRow } => !!s.row && s.row.ok && s.row.latency_ms != null)
    .sort((a, b) => a.row.latency_ms! - b.row.latency_ms!);
  const avgMs = timed.length ? Math.round(timed.reduce((sum, s) => sum + s.row.latency_ms!, 0) / timed.length) : null;
  const slowest = timed[timed.length - 1];
  const latestOf = (key: string) => daily.filter((d) => d.product === key).at(-1);
  const active7 = all.reduce((sum, p) => sum + (latestOf(p.key)?.active7 ?? 0), 0);
  const new7 = all.reduce((sum, p) => sum + (latestOf(p.key)?.new7 ?? 0), 0);
  const hasUsage = all.some((p) => latestOf(p.key)?.active7 != null);
  const issues = health?.issues ?? [];
  const checkButton = owner ? (
    <form action={runMonitorNow}>
      <SubmitButton label={L("立即檢查", "Check now")} pending={L("檢查中…", "Checking…")} className="btn primary" />
    </form>
  ) : null;

  return (
    <>
      {/* 電腦版：重點數字卡；手機版照舊用下面的標題列 */}
      <KpiRow label={L("重點數字", "Key numbers")}>
        <Kpi
          pop
          tone={down ? "danger" : status.length ? "ok" : ""}
          label={L("服務狀態", "Services")}
          value={status.length ? `${status.length - down} / ${status.length}` : "—"}
          hint={down ? L(`${down} 項服務異常`, `${down} down`) : status.length ? L("全部正常", "All up") : L("還沒有檢查紀錄", "No checks yet")}
        />
        <Kpi
          label={L("平均回應時間", "Average response")}
          value={avgMs != null ? <>{avgMs}<small className="kpi-unit"> {L("毫秒", "ms")}</small></> : "—"}
          hint={slowest ? L(`最慢：${slowest.name} ${slowest.row.latency_ms} 毫秒`, `Slowest: ${slowest.name} ${slowest.row.latency_ms} ms`) : L("還沒有資料", "No data yet")}
        />
        <Kpi
          label={L("7 天有在用的人", "Active in 7 days")}
          value={hasUsage ? active7.toLocaleString("en-US") : "—"}
          hint={hasUsage ? L(`全部產品加總・7 天新增 ${new7.toLocaleString("en-US")}`, `All products · ${new7.toLocaleString("en-US")} new in 7d`) : L("還沒有使用數字", "No usage numbers yet")}
        />
        {owner ? (
          <Kpi
            tone={issues.some((i) => i.level === "error") ? "danger" : issues.length ? "warn" : health ? "ok" : ""}
            label={L("每週系統健康", "Weekly health")}
            value={health ? (issues.length ? issues.length : L("正常", "OK")) : "—"}
            hint={health ? (issues.length ? L("項要你看一下", "to look at") : L(`上次健檢 ${taipeiShort(health.at)}`, `Checked ${taipeiShort(health.at)}`)) : L("每週一早上 9 點自動檢查", "Runs every Monday 9 am")}
          />
        ) : (
          <Kpi label={L("上次檢查", "Last check")} value={lastCheck ? taipeiShort(lastCheck) : "—"} hint={L("每 5 分鐘檢查一次", "Checked every 5 minutes")} />
        )}
      </KpiRow>
      <div className="view-line d-only">
        <span className="muted small">{lastCheck ? L(`上次檢查 ${taipeiShort(lastCheck)}・每 5 分鐘一次`, `Last check ${taipeiShort(lastCheck)} · every 5 min`) : L("還沒有檢查紀錄", "No checks yet")}</span>
        <span className="push">{checkButton}</span>
      </div>
      <div className="page-title with-action m-only">
        <div>
          <h1>{L("監控", "Monitor")}</h1>
          <p className="muted">
            {down ? L(`${down} 項服務異常`, `${down} service${down > 1 ? "s" : ""} down`) : status.length ? L("所有服務正常", "All services up") : L("還沒有檢查紀錄", "No checks yet")}
            {lastCheck ? L(`・上次檢查 ${taipeiShort(lastCheck)}`, `・last check ${taipeiShort(lastCheck)}`) : ""}
          </p>
        </div>
        {checkButton && <div className="title-actions">{checkButton}</div>}
      </div>
      {msg && <p className="notice glass">{msg}</p>}
      {owner && stale && status.length > 0 && (
        <p className="notice glass">
          {L(
            "超過 20 分鐘沒有自動檢查，5 分鐘排程可能沒在跑。請確認 ideabox 的 Supabase 已執行 migration-004-monitor.sql。",
            "No automatic check in over 20 minutes, so the 5-minute schedule may not be running. Make sure migration-004-monitor.sql has been run on the ideabox Supabase.",
          )}
        </p>
      )}

      <div className="page-split">
      <div className="page-main">
      {view === "all" && owner && <HealthCard report={health} />}

      <div className="monitor-grid stagger" key={view}>
        {products.map((p) => (
          <ProductCard
            key={p.key}
            product={p}
            services={p.services.map((sv) => ({ ...sv, row: byService.get(sv.id) ?? null }))}
            daily={daily.filter((d) => d.product === p.key)}
            setupHint={p.setupHint ? L(...p.setupHint) : ""}
            now={now}
          />
        ))}
      </div>

      {view === "all" && owner && <SitesPanel projects={projects} empty={!all.length} />}
      {!owner && !all.length && <p className="muted">{L("你的專案還沒有接上產品監控。", "None of your projects are monitored yet.")}</p>}
      </div>
      <aside className="page-aside d-only" aria-label={L("監控概況", "Monitor overview")}>
        <SidePanel title={L("回應時間排行", "Response times")}>
          {timed.length ? (
            <>
              <p className="muted small side-note">{L("越短越好，單位毫秒", "Shorter is better (ms)")}</p>
              {timed.map((s) => <BarRow key={s.id} wide label={s.name} n={s.row.latency_ms!} max={slowest.row.latency_ms!} />)}
            </>
          ) : <p className="muted small">{L("還沒有資料", "No data yet")}</p>}
        </SidePanel>
        {down > 0 && (
          <SidePanel className="nudge" title={L("現在異常", "Down right now")}>
            {status.filter((s) => !s.ok).map((s) => (
              <div className="side-row" key={s.service}>
                <span className="grow">
                  <span className="side-title">{all.flatMap((p) => p.services.map((sv) => ({ id: sv.id, name: `${p.label}・${L(sv.zh, sv.en)}` }))).find((x) => x.id === s.service)?.name ?? s.service}</span>
                  <span className="muted small">{L(`中斷 ${durationText(now - new Date(s.changed_at).getTime())}`, `Down for ${durationText(now - new Date(s.changed_at).getTime(), "en")}`)}</span>
                </span>
              </div>
            ))}
          </SidePanel>
        )}
      </aside>
      </div>
    </>
  );
}

function ProductCard({
  product,
  services,
  daily,
  setupHint,
  now,
}: {
  product: MonitorProduct;
  services: { id: string; zh: string; en: string; row: StatusRow | null }[];
  daily: DailyRow[];
  setupHint: string;
  now: number;
}) {
  const L = useL();
  const owner = useAccess().owner;
  const active = services.filter((s) => s.row);
  const anyDown = active.some((s) => !s.row!.ok);
  const latest = daily[daily.length - 1];
  // 和 7 天前比較
  const weekAgo = latest ? daily.find((d) => d.day >= shiftDay(latest.day, -7)) : undefined;
  const userDelta = latest?.users != null && weekAgo?.users != null && weekAgo !== latest ? latest.users - weekAgo.users : null;
  const limit = product.dbLimitBytes ?? null;
  const m = product.metrics ?? { users: ["總用戶", "Total users"], active7: ["7 天活躍", "Active in 7d"], new7: ["7 天新增", "New in 7d"] };
  const pct = latest?.db_bytes != null && limit ? Math.min(100, (latest.db_bytes / limit) * 100) : null;

  return (
    <section className={`glass panel product-card ${anyDown ? "is-down" : ""}`}>
      <header className="product-head">
        <span className={`dot ${!active.length ? "unknown" : anyDown ? "down" : "up"}`} aria-hidden />
        <h3>{product.label}</h3>
        <span className="muted small push">{!active.length ? L("尚未檢查", "Not checked yet") : anyDown ? L("有服務異常", "Service down") : L("正常運作中", "All good")}</span>
      </header>

      <ul className="service-list">
        {services.map(({ id, zh, en, row }) => (
          <li key={id} className={row && !row.ok ? "down" : ""}>
            <span className={`dot sm ${!row ? "unknown" : !row.ok ? "down" : row.fail_count ? "warn" : "up"}`} aria-hidden />
            <span>{product.site ? <a href={product.site.url} target="_blank" rel="noreferrer">{L(zh, en)}</a> : L(zh, en)}</span>
            <span className="muted small push">
              {!row
                ? L("尚未檢查", "Not checked yet")
                : !row.ok
                  ? L(`中斷 ${durationText(now - new Date(row.changed_at).getTime())}`, `Down for ${durationText(now - new Date(row.changed_at).getTime(), "en")}`)
                  : row.fail_count
                    ? L("剛剛失敗一次，觀察中", "Failed once, watching")
                    : `${row.latency_ms ?? "—"} ms`}
            </span>
            {row?.last_error && <span className="service-error">{row.last_error}</span>}
          </li>
        ))}
      </ul>

      {product.site && owner ? (
        <form action={removeMonitorSite} className="site-remove">
          <input type="hidden" name="id" value={product.site.id} />
          <span className="muted small">{product.site.url.replace(/^https?:\/\//, "")}</span>
          <ConfirmButton label={L("不再監控", "Stop monitoring")} message={L("確定不再監控這個網址？", "Stop monitoring this URL?")} className="btn small ghost" />
        </form>
      ) : latest ? (
        <>
          <div className="metric-row">
            <div>
              <b>{latest.users ?? "—"}</b>
              <span>{L(...m.users)}{userDelta ? L(`（7 天 ${userDelta > 0 ? "+" : ""}${userDelta}）`, ` (7d ${userDelta > 0 ? "+" : ""}${userDelta})`) : ""}</span>
            </div>
            <div>
              <b>{latest.active7 ?? "—"}</b>
              <span>{L(...m.active7)}</span>
            </div>
            <div>
              <b>{latest.new7 ?? "—"}</b>
              <span>{L(...m.new7)}</span>
            </div>
          </div>
          <Sparkline values={daily.map((d) => d.users ?? 0)} label={L(...m.users)} />
          {limit ? (
            <div className="db-usage">
              <div className="db-usage-label">
                <span>{product.dbLabel ? L(...product.dbLabel) : L("資料庫用量", "Database usage")}</span>
                <span className="muted small">{formatBytes(latest.db_bytes)}／{formatBytes(limit)}</span>
              </div>
              <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct ?? 0)} aria-label={L("資料庫用量", "Database usage")}>
                <span style={{ width: `${Math.max(1, pct ?? 0)}%` }} className={pct != null && pct >= DB_WARN_RATIO * 100 ? "warn" : ""} />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        !setupHint && <p className="muted small">{L("第一次檢查後就會出現用戶數與資料庫用量。", "User counts and database usage appear after the first check.")}</p>
      )}
      {setupHint && <p className="muted small">{setupHint}</p>}
    </section>
  );
}

/** 通用網址監控：加一個要檢查的網址（每 5 分鐘檢查網站有沒有活著） */
function SitesPanel({ projects, empty }: { projects: { slug: string; name: string }[]; empty: boolean }) {
  const L = useL();
  return (
    <section className="glass panel sites-panel">
      <h3>{L("加一個要監控的網址", "Monitor a URL")}</h3>
      <p className="muted small">
        {empty
          ? L("還沒有監控任何東西。填你的網站網址，每 5 分鐘會檢查一次，連不上或恢復時傳 Telegram。", "Nothing is monitored yet. Add your site's URL; it's checked every 5 minutes and you get a Telegram message when it goes down or recovers.")
          : L("每 5 分鐘檢查一次網站有沒有回應（伺服器錯誤或連不上才算異常）。", "Checked every 5 minutes (only server errors or no response count as down).")}
      </p>
      <form action={addMonitorSite} className="site-form">
        <input name="name" placeholder={L("名稱，例如：官網", "Name, e.g. Website")} maxLength={40} required aria-label={L("名稱", "Name")} />
        <input name="url" placeholder="https://example.com" required inputMode="url" aria-label={L("網址", "URL")} />
        {projects.length > 0 && (
          <select name="slug" defaultValue="" aria-label={L("對應的專案", "Project")}>
            <option value="">{L("不屬於專案", "No project")}</option>
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        )}
        <SubmitButton label={L("加入監控", "Add")} pending={L("加入中…", "Adding…")} className="btn primary" />
      </form>
    </section>
  );
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 近 40 天總用戶的小折線 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  const L = useL();
  if (values.length < 2) return null;
  const w = 300;
  const h = 44;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`);
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label={L(`近 ${values.length} 天${label} ${min} → ${values[values.length - 1]}`, `${label}, last ${values.length} days: ${min} → ${values[values.length - 1]}`)}>
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** 每週健康檢查（週一早上 9 點自動執行，有問題才傳 Telegram） */
function HealthCard({ report }: { report: HealthReport | null }) {
  const L = useL();
  const lang = useLang();
  const issues = report?.issues ?? [];
  const s = report?.stats;
  return (
    <section className={`glass panel health-card ${issues.length ? "has-issues" : ""}`}>
      <header className="product-head">
        <span className={`dot ${!report ? "unknown" : issues.some((i) => i.level === "error") ? "down" : issues.length ? "warn" : "up"}`} aria-hidden />
        <h3>{L("系統健康", "System health")}</h3>
        <span className="muted small push">
          {report
            ? L(`上次健檢 ${taipeiShort(report.at)}`, `Last check ${taipeiShort(report.at)}`)
            : L("還沒有健檢紀錄・每週一早上 9 點自動檢查", "No checks yet · runs every Monday 9 am")}
        </span>
        <form action={runHealthNow}>
          <SubmitButton label={L("立即健檢", "Check now")} pending={L("檢查中…", "Checking…")} className="btn small" />
        </form>
      </header>
      {report && (
        issues.length ? (
          <ul className="health-list">
            {issues.map((i, n) => (
              <li key={n} className={i.level}>
                <span aria-hidden>{i.level === "error" ? "🔴" : "🟡"}</span>
                <span>{lang === "en" ? i.en : i.zh}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small">{L("✅ 排程、分析、AI 費用、Telegram 與網站錯誤都正常", "✅ Schedules, analysis, AI cost, Telegram and site errors all look fine")}</p>
        )
      )}
      {s && (
        <p className="muted small">
          {L(
            `涵蓋 ${s.days} 天・監控執行 ${s.runs.monitor ?? 0} 次・錯誤 ${s.errors} 次・本週 AI $${s.aiUsdWeek.toFixed(2)}${s.aiUsdBaseline != null ? `（平常 $${s.aiUsdBaseline.toFixed(2)}／週）` : ""}`,
            `Covers ${s.days} days · monitor ran ${s.runs.monitor ?? 0} times · ${s.errors} errors · AI this week $${s.aiUsdWeek.toFixed(2)}${s.aiUsdBaseline != null ? ` (usually $${s.aiUsdBaseline.toFixed(2)}/week)` : ""}`,
          )}
        </p>
      )}
    </section>
  );
}
