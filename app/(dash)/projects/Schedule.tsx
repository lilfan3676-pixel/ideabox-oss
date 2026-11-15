"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useL } from "@/app/LangProvider";
import { stageSegments, type Milestone, type Project } from "@/lib/projectLogic";

// 全部專案的時程表（甘特圖）：每個專案一列，過去的階段色條、預估接下來的階段（虛線）、里程碑、每天有沒有更新的小點。
// 範圍可切換 3 個月／6 個月／1 年，今天放在正中間。

export type StageLog = { project_id: string; at: string; text: string };
export type ActivityLog = { project_id: string; at: string };

const DAY = 86_400_000;
const RANGES = [
  { days: 90, zh: "3 個月", en: "3 mo" },
  { days: 180, zh: "6 個月", en: "6 mo" },
  { days: 365, zh: "1 年", en: "1 yr" },
] as const;
const KEY = "ib-schedule-range";

/** 台北的某一天 00:00 */
const dayStart = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00+08:00`);
const taipeiDay = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);

export function Schedule({
  projects,
  milestones,
  stageLogs,
  activity,
  today,
  now,
  colorOf,
}: {
  projects: Project[];
  milestones: Milestone[];
  stageLogs: StageLog[];
  activity: ActivityLog[];
  today: string;
  now: number;
  colorOf: (id: string) => string;
}) {
  const L = useL();
  const [range, setRange] = useState<number>(180);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (RANGES.some((r) => r.days === v)) setRange(v);
    } catch {
      /* 存不了就用預設 */
    }
  }, []);
  const pick = (d: number) => {
    setRange(d);
    try {
      localStorage.setItem(KEY, String(d));
    } catch {
      /* 無痕模式等 */
    }
  };

  const t0 = dayStart(today) - (range / 2) * DAY;
  const t1 = dayStart(today) + (range / 2) * DAY;
  const pos = (t: number) => ((t - t0) / (t1 - t0)) * 100;
  const clampPct = (v: number) => Math.min(100, Math.max(0, v));

  // 刻度：3 個月、6 個月每月一格；1 年每兩個月一格
  const ticks = useMemo(() => {
    const out: { left: number; label: string; year: boolean }[] = [];
    const d = new Date(t0 + 8 * 3_600_000);
    d.setUTCDate(1);
    d.setUTCHours(0, 0, 0, 0);
    const step = range > 200 ? 2 : 1;
    for (let i = 0; i < 16; i++) {
      d.setUTCMonth(d.getUTCMonth() + (i === 0 ? 1 : step));
      const t = dayStart(d.toISOString());
      if (t >= t1) break;
      const m = d.getUTCMonth() + 1;
      out.push({ left: pos(t), label: m === 1 ? `${d.getUTCFullYear()}` : L(`${m}月`, `${m}`), year: m === 1 });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, t1, range, L]);

  const rows = useMemo(
    () =>
      projects.map((p) => {
        const logs = stageLogs.filter((l) => l.project_id === p.id);
        const segs = stageSegments(p, logs, now);
        const ms = milestones.filter((m) => m.project_id === p.id);
        // 預估：有未來的里程碑時，剩下的階段平均排到最後一個里程碑前（只是推估）
        const future = ms.filter((m) => !m.done && m.due > today).map((m) => dayStart(m.due));
        const rest = p.stages.slice(p.stage + 1);
        const end = future.length ? Math.max(...future) : 0;
        const forecast =
          end && rest.length && p.status === "active"
            ? rest.map((name, i) => {
                const w = (end - now) / rest.length;
                return { name, from: now + i * w, to: now + (i + 1) * w };
              })
            : [];
        // 每天有幾筆更新
        const days = new Map<string, number>();
        for (const a of activity) if (a.project_id === p.id) days.set(taipeiDay(Date.parse(a.at)), (days.get(taipeiDay(Date.parse(a.at))) ?? 0) + 1);
        return { p, segs, ms, forecast, days };
      }),
    [projects, stageLogs, milestones, activity, now, today],
  );

  const overdue = milestones.filter((m) => !m.done && m.due < today && projects.some((p) => p.id === m.project_id && p.status !== "done"));
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const todayLeft = pos(now);

  return (
    <section className="glass schedule" aria-label={L("全部專案時程表", "All projects schedule")}>
      <div className="schedule-head">
        <b>{L("時程表", "Schedule")}</b>
        <span className="muted small">{L("色條是走過的階段，虛線是依里程碑推估的接下來階段", "Bars are past stages; dashed boxes are estimated next stages based on milestones")}</span>
        <div className="seg push" role="group" aria-label={L("時間範圍", "Range")}>
          {RANGES.map((r) => (
            <button key={r.days} type="button" className={range === r.days ? "active" : ""} aria-pressed={range === r.days} onClick={() => pick(r.days)}>
              {L(r.zh, r.en)}
            </button>
          ))}
        </div>
      </div>

      <div className="schedule-grid view-swap" key={range}>
        {/* 月份刻度 */}
        <div className="schedule-label" />
        <div className="schedule-axis">
          {ticks.map((t) => (
            <span key={`${t.label}-${t.left}`} className={`schedule-tick ${t.year ? "year" : ""}`} style={{ left: `${t.left}%` }}>{t.label}</span>
          ))}
          <span className="schedule-tick today" style={{ left: `${todayLeft}%` }}>{L("今天", "Today")}</span>
        </div>

        {rows.map(({ p, segs, ms, forecast, days }) => (
          <div key={p.id} className={`schedule-row ${p.status !== "active" ? "dim" : ""}`} style={{ ["--c" as string]: colorOf(p.id) }}>
            <Link href={`/projects/${p.slug}`} className="schedule-label">
              <span className="schedule-dot" aria-hidden />
              <span className="schedule-name">{p.name}</span>
              {p.status === "paused" && <span className="muted small">{L("暫停", "Paused")}</span>}
            </Link>
            <div className="schedule-track">
              {ticks.map((t) => (
                <span key={`g${t.left}`} className="schedule-gridline" style={{ left: `${t.left}%` }} aria-hidden />
              ))}
              {segs.map((s, i) => {
                const a = clampPct(pos(Date.parse(s.from)));
                const b = clampPct(pos(Date.parse(s.to)));
                if (b <= 0 || a >= 100 || b - a <= 0) return null;
                const idx = p.stages.indexOf(s.name);
                const strength = 35 + Math.round(((idx >= 0 ? idx : i) / Math.max(1, p.stages.length - 1)) * 55);
                return (
                  <span
                    key={i}
                    className={`schedule-bar ${s.current ? "current" : ""}`}
                    style={{ left: `${a}%`, width: `${b - a}%`, background: `color-mix(in srgb, var(--c) ${strength}%, var(--field))` }}
                    title={`${s.name}：${s.from.slice(0, 10)} ～ ${s.current ? L("現在", "now") : s.to.slice(0, 10)}（${s.days} ${L("天", "days")}）`}
                  >
                    <span>{s.name}</span>
                  </span>
                );
              })}
              {forecast.map((f) => {
                const a = clampPct(pos(f.from));
                const b = clampPct(pos(f.to));
                if (b - a <= 0) return null;
                return (
                  <span key={f.name} className="schedule-bar forecast" style={{ left: `${a}%`, width: `${b - a}%` }} title={L(`預估：${f.name}`, `Estimated: ${f.name}`)}>
                    <span>{f.name}</span>
                  </span>
                );
              })}
              {ms.map((m) => {
                const x = pos(dayStart(m.due) + DAY / 2);
                if (x < 0 || x > 100) return null;
                const late = !m.done && m.due < today;
                return (
                  <span key={m.id} className={`schedule-ms ${m.done ? "done" : ""} ${late ? "late" : ""}`} style={{ left: `${x}%` }} title={`${m.title}（${m.due}）${m.done ? L("・已完成", " · done") : late ? L("・已過期", " · overdue") : ""}`}>
                    ◆<em>{m.title}</em>
                  </span>
                );
              })}
              {/* 活動量：有更新的日子一個小點，越多越深 */}
              <div className="schedule-activity" aria-hidden>
                {[...days.entries()].map(([d, n]) => {
                  const x = pos(dayStart(d) + DAY / 2);
                  if (x < 0 || x > 100) return null;
                  return <span key={d} style={{ left: `${x}%`, opacity: Math.min(1, 0.35 + n * 0.2) }} />;
                })}
              </div>
            </div>
          </div>
        ))}
        {/* 今天的直線穿過所有列 */}
        <span className="schedule-today" style={{ ["--x-num" as string]: Math.min(1, Math.max(0, todayLeft / 100)) }} aria-hidden />
      </div>

      {overdue.length > 0 && (
        <p className="timeline-overdue small">
          ⚠️ {L("已過期：", "Overdue: ")}
          {overdue.map((m) => `${nameOf(m.project_id)}｜${m.title}（${m.due.slice(5).replace("-", "/")}）`).join("、")}
        </p>
      )}
    </section>
  );
}
