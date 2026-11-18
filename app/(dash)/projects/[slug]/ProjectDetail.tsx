"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useL, useLang } from "@/app/LangProvider";
import { daysBetween } from "@/lib/dates";
import type { MonitorProduct } from "@/lib/modules/types";
import type { Idea } from "@/lib/db";
import type { AgentSession } from "@/lib/officeLogic";
import type { RadarReport } from "@/lib/radarLogic";
import { ProjectLinks } from "../ProjectLinks";
import { RadarSection } from "./RadarSection";
import { Delta, Kpi, KpiRow, SidePanel } from "../../Insight";
import { projectDetailInsights } from "@/lib/insights";
import { stageName, stageSegments, type LogSource, type Milestone, type Project, type ProjectLog } from "@/lib/projectLogic";

export type ProductData = {
  info: MonitorProduct | null; // 對應的監控產品（沒有就是 null）
  daily: { day: string; users: number | null; active7: number | null; new7: number | null; db_bytes: number | null }[];
  services: { service: string; ok: boolean; checked_at: string | null; latency_ms: number | null }[];
  feedback: string[] | null; // 模組提供的回報時間（最近 12 週，例如封測回報）
};

const SOURCE_ICON: Record<LogSource, string> = { manual: "✍️", telegram: "💬", claude: "🤖", github: "⬆️", slack: "📣", system: "⚙️" };
const DAY = 86_400_000;

export function ProjectDetail({
  project: p,
  color,
  milestones,
  logs,
  ideas,
  showIdeas = true,
  showRadar = true,
  showProduct = true,
  product,
  people,
  radar,
  today,
  now,
}: {
  project: Project;
  color: string;
  milestones: Milestone[];
  logs: ProjectLog[];
  ideas: Idea[];
  showIdeas?: boolean; // 合夥人沒開「點子庫」「話題雷達」時不顯示
  showRadar?: boolean;
  showProduct?: boolean; // 合夥人沒開「產品監控」時不顯示產品數據
  product: ProductData;
  people: AgentSession[];
  radar: { reports: RadarReport[]; ready: boolean; enabled: boolean };
  today: string;
  now: number;
}) {
  const L = useL();
  const segments = useMemo(() => stageSegments(p, logs, now), [p, logs, now]);
  const statusText = p.status === "active" ? L("進行中", "Active") : p.status === "paused" ? L("暫停", "Paused") : L("完成", "Done");

  const ins = useMemo(() => projectDetailInsights(milestones, logs, today, now), [milestones, logs, today, now]);
  const current = segments.find((s) => s.current);
  const stageLine = L(`第 ${p.stage + 1}／${p.stages.length} 階段：${stageName(p)}`, `Stage ${p.stage + 1}/${p.stages.length}: ${stageName(p)}`);
  // 有接產品監控、而且看得到的，前兩張卡放產品數字；沒有的放目前階段和點子
  const m = product.info?.metrics ?? DEFAULT_METRICS;
  const usersSeries = showProduct ? product.daily.filter((d) => d.users !== null).map((d) => Number(d.users)) : [];
  const activeSeries = showProduct ? product.daily.filter((d) => d.active7 !== null).map((d) => Number(d.active7)) : [];
  const lastDaily = showProduct ? product.daily[product.daily.length - 1] : undefined;
  const users = usersSeries.length ? usersSeries[usersSeries.length - 1] : null;
  const active = activeSeries.length ? activeSeries[activeSeries.length - 1] : null;
  const adopted = ideas.filter((i) => i.adopted).length;
  const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const nextStep = p.next_step || L("還沒寫下一步", "No next step yet");

  return (
    <div className="project-detail stagger" style={{ ["--proj" as string]: color }}>
      {/* 電腦版：一行看完名稱、狀態、階段，連結靠右 */}
      <div className="view-line pd-head d-only">
        <Link href="/projects" className="btn ghost small">{L("← 所有專案", "← All projects")}</Link>
        <h2 className="pd-name">{p.name}</h2>
        <span className={`badge ${p.status === "active" ? "adopted" : ""}`}>{statusText}</span>
        <span className="muted small">{stageLine}</span>
        {people.length > 0 && <Link href="/office" className="muted small">{L(`辦公室 ${people.length} 人`, `${people.length} in the office`)}</Link>}
        <span className="push"><ProjectLinks links={p.links} size={18} /></span>
      </div>
      <div className="page-title with-action m-only">
        <div>
          <p className="muted small"><Link href="/projects">{L("← 所有專案", "← All projects")}</Link></p>
          <h1>{p.name}</h1>
          <p className="muted title-stats">
            <span>{statusText}</span>
            <span>{stageLine}</span>
            {people.length > 0 && <span><Link href="/office">{L(`辦公室 ${people.length} 人`, `${people.length} in the office`)}</Link></span>}
          </p>
        </div>
      </div>
      <div className="m-only"><ProjectLinks links={p.links} size={18} /></div>

      <KpiRow label={L("重點數字", "Key numbers")}>
        {users !== null ? (
          <Kpi pop label={L(...m.users)} value={users.toLocaleString()} hint={lastDaily?.new7 != null ? L(`這 7 天 +${lastDaily.new7}`, `+${lastDaily.new7} in 7 days`) : L("最近 90 天", "Last 90 days")} data={usersSeries} />
        ) : (
          <Kpi pop label={L("目前階段", "Current stage")} value={<span className="kpi-text">{stageName(p)}</span>} hint={L(`第 ${p.stage + 1}／${p.stages.length} 階段${current ? `・已經 ${current.days} 天` : ""}`, `Stage ${p.stage + 1}/${p.stages.length}${current ? ` · ${current.days} days` : ""}`)} />
        )}
        {active !== null ? (
          <Kpi label={L(...m.active7)} value={active.toLocaleString()} hint={users ? L(`佔全部 ${Math.round((active / users) * 100)}%`, `${Math.round((active / users) * 100)}% of all`) : " "} data={activeSeries} />
        ) : showIdeas ? (
          <Kpi label={L("這個專案的點子", "Ideas")} value={ideas.length} hint={L(`已採用 ${adopted} 則`, `${adopted} adopted`)} />
        ) : (
          <Kpi label={L("里程碑", "Milestones")} value={`${ins.msDone}／${ins.msTotal}`} hint={L("已完成／全部", "done / total")} />
        )}
        <Kpi
          label={L("本週工作日誌", "Logs this week")}
          value={ins.logsWeek}
          hint={<><Delta now={ins.logsWeek} prev={ins.logsLastWeek} flat={L("跟上週一樣", "Same as last week")} />{ins.logsWeek !== ins.logsLastWeek ? L(" 比上週", " vs last week") : ""}</>}
          data={ins.weekly}
        />
        <Kpi
          tone={ins.overdue ? "danger" : ins.next && ins.next.days <= 3 ? "warn" : ""}
          label={L("下一個里程碑", "Next milestone")}
          value={ins.next ? (ins.next.days === 0 ? L("今天", "Today") : <>{ins.next.days}<span className="kpi-unit"> {L("天後", "days")}</span></>) : "—"}
          hint={ins.next ? `${mmdd(ins.next.due)} ${ins.next.title}${ins.overdue ? L(`・另有 ${ins.overdue} 個過期`, ` · ${ins.overdue} overdue`) : ""}` : ins.overdue ? L(`${ins.overdue} 個已過期`, `${ins.overdue} overdue`) : L("沒有排里程碑", "None scheduled")}
        />
      </KpiRow>

      {p.description && <p className="glass pd-desc">{p.description}</p>}

      <div className="page-split pd-split">
        <div className="page-main pd-main">
          <div className="glass pd-next m-only">
            <span className="muted small">{L("下一步", "Next step")}</span>
            <b>👉 {nextStep}</b>
          </div>

          <section className="glass pd-card">
            <h2 className="detail-h">{L("階段歷程", "Stage history")}</h2>
            <StageChart segments={segments} stages={p.stages} milestones={milestones} today={today} now={now} />
          </section>

          {showProduct && <ProductSection product={product} />}

          {showIdeas && <div className="m-only"><IdeasSection ideas={ideas} /></div>}

          {showRadar && <RadarSection projectId={p.id} keywords={p.radar_keywords ?? []} reports={radar.reports} ready={radar.ready} enabled={radar.enabled} now={now} />}

          <section className="glass pd-card">
            <h2 className="detail-h">{L(`工作日誌（${logs.length}）`, `Work log (${logs.length})`)}</h2>
            {logs.length ? (
              <ul className="pd-log">
                {logs.map((l) => (
                  <li key={l.id}>
                    <span aria-hidden title={l.source}>{SOURCE_ICON[l.source] ?? "•"}</span>
                    <span className="muted small pd-log-at">{l.at.slice(0, 10)}</span>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{L("還沒有紀錄", "Nothing yet")}</p>
            )}
          </section>
        </div>

        {/* 電腦版右欄：下一步、里程碑、分數最高的點子（手機版這些在主欄原本的位置） */}
        <aside className="page-aside d-only" aria-label={L("專案概況", "Project overview")}>
          <SidePanel className="nudge" title={L("下一步", "Next step")}>
            <p>{nextStep}</p>
          </SidePanel>
          <SidePanel title={L("里程碑", "Milestones")} action={ins.msTotal > 0 ? <span className="muted small">{L(`完成 ${ins.msDone}／${ins.msTotal}`, `${ins.msDone}/${ins.msTotal} done`)}</span> : undefined}>
            {ins.upcoming.length ? (
              ins.upcoming.slice(0, 6).map((ms) => (
                <div className={`side-row ${ms.days < 0 ? "late" : ""}`} key={ms.id}>
                  <span className="side-date">{mmdd(ms.due)}</span>
                  <span className="grow">
                    <span className="side-title">{ms.title}</span>
                    <span className="muted small">{ms.days < 0 ? L(`過期 ${-ms.days} 天`, `${-ms.days} days overdue`) : ms.days === 0 ? L("今天", "Today") : L(`${ms.days} 天後`, `in ${ms.days} days`)}</span>
                  </span>
                </div>
              ))
            ) : (
              <p className="muted small">{ins.msTotal ? L("里程碑都完成了", "All milestones done") : L("還沒有里程碑。在專案卡片上新增。", "No milestones yet. Add one on the project card.")}</p>
            )}
          </SidePanel>
          {showIdeas && (
            <SidePanel title={L("這個專案的點子", "Ideas")} action={ideas.length > 0 ? <Link href={`/?project=${p.id}`} className="small">{L(`全部 ${ideas.length} 則`, `All ${ideas.length}`)}</Link> : undefined}>
              {ideas.length ? (
                ideas.slice(0, 5).map((i) => (
                  <div className="side-row" key={i.id}>
                    <span className="grow"><span className="side-title clamp">{i.summary || i.content?.slice(0, 60) || i.url}</span></span>
                    <b className={i.adopted ? "ok-text" : ""} title={i.adopted ? L("已採用", "Adopted") : undefined}>{i.score_total ?? "—"}{i.adopted ? " ✓" : ""}</b>
                  </div>
                ))
              ) : (
                <p className="muted small">{L("還沒有點子指定給這個專案。", "No ideas assigned yet.")}</p>
              )}
            </SidePanel>
          )}
        </aside>
      </div>
    </div>
  );
}

const DEFAULT_METRICS = { users: ["總用戶", "Total users"] as [string, string], active7: ["7 天活躍", "Active in 7d"] as [string, string], new7: ["7 天新增", "New in 7d"] as [string, string] };

// ---------- 階段歷程：橫向時間條＋里程碑 ----------

function StageChart({ segments, stages, milestones, today, now }: { segments: ReturnType<typeof stageSegments>; stages: string[]; milestones: Milestone[]; today: string; now: number }) {
  const L = useL();
  const start = Date.parse(segments[0].from);
  const lastDue = milestones.reduce((m, x) => Math.max(m, Date.parse(`${x.due}T12:00:00+08:00`)), 0);
  const end = Math.max(now + 7 * DAY, lastDue + 3 * DAY);
  const span = Math.max(DAY, end - start);
  const pos = (t: number) => ((t - start) / span) * 100;
  const total = stages.length || 1;

  return (
    <div className="stage-chart">
      {/* 「今天」標在時間條上方，不跟下面的開始／結束日期擠在一起；太靠邊時改成往內對齊 */}
      <div className="stage-today-row" aria-hidden>
        {(() => {
          const x = Math.min(100, Math.max(0, pos(now)));
          return (
            <span className="stage-axis-today" style={{ left: `${x}%`, transform: x < 8 ? "none" : x > 92 ? "translateX(-100%)" : "translateX(-50%)" }}>
              {L("今天", "Today")}
            </span>
          );
        })()}
      </div>
      <div className="stage-bar">
        {segments.map((s, i) => {
          const idx = stages.indexOf(s.name);
          // 越後面的階段顏色越深
          const strength = 30 + Math.round(((idx >= 0 ? idx : i) / Math.max(1, total - 1)) * 60);
          return (
            <div
              key={i}
              className={`stage-seg ${s.current ? "current" : ""}`}
              style={{ left: `${pos(Date.parse(s.from))}%`, width: `${Math.max(0.8, pos(Date.parse(s.to)) - pos(Date.parse(s.from)))}%`, background: `color-mix(in srgb, var(--proj) ${strength}%, var(--field))` }}
              title={`${s.name}：${s.from.slice(0, 10)} ～ ${s.current ? L("現在", "now") : s.to.slice(0, 10)}（${s.days} ${L("天", "days")}）`}
            >
              <span>{s.name}</span>
            </div>
          );
        })}
        <span className="stage-today" style={{ left: `${pos(now)}%` }} aria-hidden />
      </div>
      {/* 時間軸上只畫菱形；名稱放在下面的清單，才不會擠在一起或超出框 */}
      <div className="stage-ms" aria-hidden>
        {milestones.map((m) => (
          <span
            key={m.id}
            className={`stage-ms-dot ${m.done ? "done" : m.due < today ? "late" : ""}`}
            style={{ left: `${Math.min(100, Math.max(0, pos(Date.parse(`${m.due}T12:00:00+08:00`))))}%` }}
            title={`${m.title}（${m.due}）`}
          >
            ◆
          </span>
        ))}
      </div>
      <div className="stage-axis muted small">
        <span>{segments[0].from.slice(0, 10)}</span>
        <span>{new Date(end).toISOString().slice(0, 10)}</span>
      </div>
      {milestones.length > 0 && (
        <ul className="stage-ms-list m-only">
          {milestones.map((m) => (
            <li key={m.id} className={m.done ? "done" : m.due < today ? "late" : ""}>
              <span aria-hidden>◆</span>
              <b>{m.due.slice(5).replace("-", "/")}</b>
              <span>{m.title}</span>
              {m.done && <span className="muted">{L("已完成", "done")}</span>}
              {!m.done && m.due < today && <span>{L("已過期", "overdue")}</span>}
            </li>
          ))}
        </ul>
      )}
      <table className="stage-table">
        <thead>
          <tr><th>{L("階段", "Stage")}</th><th>{L("開始", "Started")}</th><th>{L("待了", "Duration")}</th></tr>
        </thead>
        <tbody>
          {segments.map((s, i) => (
            <tr key={i} className={s.current ? "current" : ""}>
              <td>{s.name}{s.current ? L("（目前）", " (now)") : ""}</td>
              <td>{s.from.slice(0, 10)}</td>
              <td>{L(`${s.days} 天`, `${s.days} days`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {milestones.some((m) => !m.done) && (
        <p className="muted small m-only">
          {L("接下來：", "Coming up: ")}
          {milestones.filter((m) => !m.done && m.due >= today).slice(0, 3).map((m) => `${m.title}（${daysBetween(today, m.due)} ${L("天後", "days")}）`).join("、") || L("沒有", "none")}
        </p>
      )}
    </div>
  );
}

// ---------- 產品數據 ----------

function ProductSection({ product }: { product: ProductData }) {
  const L = useL();
  const { daily, services, feedback, info } = product;
  const lang = useLang();
  const serviceLabel = (id: string) => {
    const sv = info?.services.find((x) => x.id === id);
    return sv ? (lang === "en" ? sv.en : sv.zh) : id;
  };
  const m = info?.metrics ?? DEFAULT_METRICS;
  if (!daily.length && !services.length && !feedback) {
    return (
      <section className="glass pd-card">
        <h2 className="detail-h">{L("產品數據", "Product data")}</h2>
        <p className="muted small">
          {L("這個專案還沒接產品監控。", "This project isn’t connected to product monitoring yet.")} <Link href="/monitor">{L("到監控頁加網址", "Add a URL on the Monitor page")}</Link>
        </p>
      </section>
    );
  }
  const series = (k: "users" | "active7" | "new7" | "db_bytes") => daily.filter((d) => d[k] !== null).map((d) => ({ day: d.day, v: Number(d[k]) }));
  const mb = (v: number) => `${(v / 1024 / 1024).toFixed(0)} MB`;
  const weeks = feedback ? weekly(feedback) : null;
  return (
    <section className="glass pd-card">
      <h2 className="detail-h">{L("產品數據（最近 90 天）", "Product data (last 90 days)")}</h2>
      {services.length > 0 && (
        <p className="pd-services">
          {services.map((s) => (
            <span key={s.service} className={`badge ${s.ok ? "adopted" : "warn"}`}>
              {s.ok ? "●" : "▲"} {serviceLabel(s.service)}{s.latency_ms ? `・${s.latency_ms}ms` : ""}
            </span>
          ))}
        </p>
      )}
      <div className="pd-charts">
        <LineChart title={L(...m.users)} data={series("users")} />
        <LineChart title={L(...m.active7)} data={series("active7")} />
        <LineChart title={L(...m.new7)} data={series("new7")} />
        {series("db_bytes").length > 0 && <LineChart title={L("資料庫大小", "Database size")} data={series("db_bytes")} fmt={mb} />}
        {weeks && <BarChart title={L("回報（每週）", "Reports per week")} data={weeks} />}
      </div>
    </section>
  );
}

/** 最近 12 週，每週（週一開始）幾則 */
function weekly(times: string[]): { label: string; v: number }[] {
  const out: { label: string; v: number; start: number }[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 這週一
  for (let i = 11; i >= 0; i--) {
    const s = d.getTime() - i * 7 * DAY;
    const dt = new Date(s);
    out.push({ start: s, label: `${dt.getMonth() + 1}/${dt.getDate()}`, v: 0 });
  }
  for (const t of times) {
    const ms = Date.parse(t);
    for (let i = out.length - 1; i >= 0; i--) if (ms >= out[i].start) { out[i].v++; break; }
  }
  return out.map(({ label, v }) => ({ label, v }));
}

function LineChart({ title, data, fmt = (v: number) => v.toLocaleString() }: { title: string; data: { day: string; v: number }[]; fmt?: (v: number) => string }) {
  const L = useL();
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) {
    return (
      <figure className="pd-chart">
        <figcaption>{title}</figcaption>
        <b className="pd-chart-big">{data.length ? fmt(data[0].v) : "—"}</b>
        <span className="muted small">{L("資料還不夠畫圖", "Not enough data yet")}</span>
      </figure>
    );
  }
  const w = 300;
  const h = 90;
  const min = Math.min(...data.map((d) => d.v));
  const max = Math.max(...data.map((d) => d.v));
  const range = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * w;
  const y = (v: number) => h - 6 - ((v - min) / range) * (h - 14);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.v).toFixed(1)}`).join("");
  const last = data[data.length - 1];
  const first = data[0];
  const diff = last.v - first.v;
  const shown = hover !== null ? data[hover] : last;
  return (
    <figure className="pd-chart">
      <figcaption>{title}</figcaption>
      <b className="pd-chart-big">{fmt(shown.v)}</b>
      <span className="muted small">
        {hover !== null ? shown.day : `${diff >= 0 ? "▲" : "▼"} ${fmt(Math.abs(diff))} ${L("（90 天）", "(90d)")}`}
      </span>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="pd-svg"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.round(((e.clientX - r.left) / r.width) * (data.length - 1)));
        }}
        role="img"
        aria-label={`${title}：${fmt(first.v)} → ${fmt(last.v)}`}
      >
        <path d={`${line}L${w},${h}L0,${h}Z`} className="pd-area" />
        <path d={line} className="pd-line" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={h} className="pd-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
    </figure>
  );
}

function BarChart({ title, data }: { title: string; data: { label: string; v: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const total = data.reduce((s, d) => s + d.v, 0);
  return (
    <figure className="pd-chart">
      <figcaption>{title}</figcaption>
      <b className="pd-chart-big">{data[data.length - 1].v}</b>
      <span className="muted small">12 週共 {total} 則</span>
      <div className="pd-bars" role="img" aria-label={`${title}：${data.map((d) => `${d.label} ${d.v}`).join("，")}`}>
        {data.map((d) => (
          <span key={d.label} className="pd-bar" style={{ height: `${(d.v / max) * 100}%` }} title={`${d.label}：${d.v}`} />
        ))}
      </div>
    </figure>
  );
}

// ---------- 這個專案的點子 ----------

function IdeasSection({ ideas }: { ideas: Idea[] }) {
  const L = useL();
  const [all, setAll] = useState(false);
  const adopted = ideas.filter((i) => i.adopted).length;
  const scored = ideas.filter((i) => i.score_total !== null);
  const avg = scored.length ? (scored.reduce((s, i) => s + Number(i.score_total), 0) / scored.length).toFixed(1) : "—";
  const shown = all ? ideas : ideas.slice(0, 8);
  return (
    <section className="glass pd-card">
      <h2 className="detail-h">{L("這個專案的點子", "Ideas for this project")}</h2>
      <div className="pd-stats">
        <div><b>{ideas.length}</b><span>{L("則", "ideas")}</span></div>
        <div><b>{adopted}</b><span>{L("已採用", "adopted")}</span></div>
        <div><b>{ideas.length - adopted}</b><span>{L("未採用", "not adopted")}</span></div>
        <div><b>{avg}</b><span>{L("平均分數", "avg score")}</span></div>
      </div>
      {ideas.length ? (
        <>
          <ul className="pd-ideas">
            {shown.map((i) => (
              <li key={i.id}>
                <span className="row-score">{i.score_total ?? "—"}</span>
                <span className="pd-idea-text">{i.summary || i.content?.slice(0, 60) || i.url}</span>
                {i.adopted && <span className="badge adopted">{L("已採用", "Adopted")}</span>}
              </li>
            ))}
          </ul>
          {ideas.length > 8 && (
            <button type="button" className="btn ghost small" onClick={() => setAll(!all)}>
              {all ? L("收起", "Show less") : L(`看全部 ${ideas.length} 則`, `Show all ${ideas.length}`)}
            </button>
          )}
        </>
      ) : (
        <p className="muted small">{L("還沒有點子指定給這個專案。在點子庫新增時選這個專案，或在點子詳情裡改。", "No ideas assigned yet. Pick this project when adding an idea, or change it in the idea’s details.")}</p>
      )}
    </section>
  );
}
