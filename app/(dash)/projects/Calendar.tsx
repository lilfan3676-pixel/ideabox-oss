"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import type { Milestone, Project, ProjectEvent } from "@/lib/projectLogic";
import { PLATFORM_LABEL, STATUS_LABEL, postTitle, taipeiParts, type Post } from "@/lib/postLogic";
import { ContextMenu } from "../ideaUi";
import { useAccess } from "../AccessContext";
import { editsProject } from "@/lib/accessLogic";
import { addEventAction, deleteEventAction, updateEventAction, type ProjectResult } from "./actions";
import { countInRange } from "@/lib/insights";

// 全部專案的月曆：排程（可跨好幾天，畫成橫條）＋里程碑（◆），用專案顏色區分。
// 點空白的日子新增排程，點排程可以改或刪。

type Item = { key: string; kind: "event" | "milestone"; id: string; projectId: string; title: string; start: string; end: string; time?: string | null; done?: boolean };
type Placed = Item & { col: number; span: number; lane: number; cont: boolean; more: boolean };

const LANES = 3; // 每週最多顯示 3 條，其他收成「還有 N 件」
const WEEKDAYS = [["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"], ["日", "Sun"]] as const;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

export function Calendar({
  projects,
  events,
  milestones,
  posts = [],
  ready,
  today,
  colorOf,
  report,
}: {
  projects: Project[];
  events: ProjectEvent[];
  milestones: Milestone[];
  posts?: Post[]; // 發文排程（📣，點了到專案的發文排程分頁）
  ready: boolean;
  today: string;
  colorOf: (id: string) => string;
  report: (r: ProjectResult) => void;
}) {
  const L = useL();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dir, setDir] = useState<"next" | "prev" | "">(""); // 換月份時往哪邊滑
  const [menu, setMenu] = useState<{ x: number; y: number; day?: string; item?: Item; postDay?: string } | null>(null);
  const [pending, start] = useTransition();
  const access = useAccess();
  const shown = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

  // 這個月的格子：從包含 1 號那週的星期一開始，共 6 週
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -lead);
  const weeks = Array.from({ length: 6 }, (_, w) => addDays(gridStart, w * 7));

  const items: Item[] = useMemo(
    () => [
      ...events.filter((e) => shown.has(e.project_id)).map((e) => ({ key: `e${e.id}`, kind: "event" as const, id: e.id, projectId: e.project_id, title: e.title, start: e.start_date, end: e.end_date, time: e.start_time ? e.start_time.slice(0, 5) : null })),
      ...milestones.filter((m) => shown.has(m.project_id)).map((m) => ({ key: `m${m.id}`, kind: "milestone" as const, id: m.id, projectId: m.project_id, title: m.title, start: m.due, end: m.due, done: m.done })),
    ],
    [events, milestones, shown],
  );

  // 發文排程：不佔車道（忙的那幾週會被擠到「還有 N 件」裡），每天右上角一個「📣 N」，點了列出當天的貼文。略過的不算
  const postsByDay = useMemo(() => {
    const map = new Map<string, (Post & { time: string })[]>();
    for (const x of posts) {
      if (!shown.has(x.project_id) || x.status === "skipped") continue;
      const { date, time } = taipeiParts(x.due_at);
      map.set(date, [...(map.get(date) ?? []), { ...x, time }]);
    }
    for (const list of map.values()) list.sort((a, b) => a.due_at.localeCompare(b.due_at));
    return map;
  }, [posts, shown]);

  /** 每週把排程排進固定的「車道」，跨天的橫條才會對齊 */
  const placeWeek = (ws: string): { bars: Placed[]; hidden: number[] } => {
    const we = addDays(ws, 6);
    const inWeek = items
      .filter((it) => it.start <= we && it.end >= ws)
      .sort((a, b) => a.start.localeCompare(b.start) || dayDiff(b.start, b.end) - dayDiff(a.start, a.end) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) || (a.key < b.key ? -1 : 1)); // 不用 localeCompare：伺服器和瀏覽器的語系排序不同，畫面會對不起來
    const lanes: string[] = []; // 每條車道目前排到哪天
    const bars: Placed[] = [];
    const hidden = Array(7).fill(0);
    for (const it of inWeek) {
      const s = it.start < ws ? ws : it.start;
      const e = it.end > we ? we : it.end;
      const col = dayDiff(ws, s);
      const span = dayDiff(s, e) + 1;
      let lane = lanes.findIndex((end) => end < s);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = e;
      if (lane >= LANES) {
        for (let c = col; c < col + span; c++) hidden[c]++;
        continue;
      }
      bars.push({ ...it, col, span, lane, cont: it.start < ws, more: it.end > we });
    }
    return { bars, hidden };
  };

  const go = (m: string) => {
    if (m === month) return;
    setDir(m > month ? "next" : "prev");
    setMonth(m);
  };
  const move = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    go(d.toISOString().slice(0, 7));
  };
  const run = (fn: () => Promise<ProjectResult>) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false }) as ProjectResult);
      report(r);
      if (r.ok) setMenu(null);
    });

  const [y, m] = month.split("-").map(Number);
  // 這個月的重點數字（電腦版月曆上方）與每週小計
  const monthEnd = addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
    const postsInMonth = [...postsByDay].filter(([d]) => d >= first && d <= monthEnd).reduce((a, [, list]) => a + list.length, 0);
  const inMonth = countInRange(items, first, monthEnd);
  const timed = items.filter((it) => it.kind === "event" && it.time && it.start <= monthEnd && it.end >= first).length;
  const weekSums = weeks.map((ws) => ({ ws, ...countInRange(items, ws, addDays(ws, 6)) }));
  const busiest = weekSums.reduce<(typeof weekSums)[number] | null>((best, w) => (w.events + w.milestones > (best ? best.events + best.milestones : 0) ? w : best), null);
  const monthShort = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
  const live = projects.filter((p) => p.status !== "done");
  // 合夥人：只有「可編輯」的專案能新增／改排程
  const editable = live.filter((p) => editsProject(access, p.id));

  return (
    <section className="glass calendar" aria-label={L("全部專案月曆", "All projects calendar")}>
      <div className="calendar-hero d-only">
        <div>
          <b className="calendar-month">{monthShort}</b>
          <span className="muted small">{L(`${y} 年 ${m} 月・全部專案`, `${y} · all projects`)}</span>
        </div>
        <dl className="calendar-hero-stats">
          <div><dt>{L("排程", "Events")}</dt><dd className="accent">{inMonth.events}</dd></div>
          <div><dt>{L("里程碑", "Milestones")}</dt><dd>{inMonth.milestones}</dd></div>
          {postsInMonth > 0 ? <div><dt>{L("發文", "Posts")}</dt><dd>{postsInMonth}</dd></div> : <div><dt>{L("有設定時間", "With a time")}</dt><dd>{timed}</dd></div>}
          <div><dt>{L("最忙的一週", "Busiest week")}</dt><dd>{busiest ? md(busiest.ws) : "—"}</dd></div>
        </dl>
      </div>
      <div className="calendar-head">
        <b className="calendar-title m-only">{L(`${y} 年 ${m} 月`, new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }))}</b>
        <div className="calendar-nav">
          <button type="button" className="btn ghost small" onClick={() => move(-1)} aria-label={L("上個月", "Previous month")}>‹</button>
          <button type="button" className="btn ghost small" onClick={() => go(today.slice(0, 7))}>{L("今天", "Today")}</button>
          <button type="button" className="btn ghost small" onClick={() => move(1)} aria-label={L("下個月", "Next month")}>›</button>
        </div>
        <span className="muted small push">{L("點空白的日子新增排程；◆ 是里程碑、📣 是當天要發的貼文", "Click an empty day to add; ◆ = milestone, 📣 = posts due")}</span>
      </div>
      {!ready && <p className="error small">{L("排程需要先在 ideabox 的 Supabase 執行 migration-015-events.sql（里程碑照常顯示）。", "Scheduling needs migration-015-events.sql (milestones still show).")}</p>}

      <div className="calendar-row" aria-hidden>
        <div className="calendar-weekdays">
          {WEEKDAYS.map(([zh, en], i) => <span key={zh} className={i >= 5 ? "weekend" : ""}>{L(zh, en)}</span>)}
        </div>
        <span className="calendar-sum-head d-only">{L("這週小計", "This week")}</span>
      </div>
      <div className={`calendar-grid ${dir ? `slide-${dir}` : ""}`} key={month}>
        {weeks.map((ws, wi) => {
          const { bars, hidden } = placeWeek(ws);
          const sum = weekSums[wi];
          return (
            <div key={ws} className="calendar-row">
            <div className="calendar-week">
              {Array.from({ length: 7 }, (_, c) => {
                const d = addDays(ws, c);
                const other = d.slice(0, 7) !== month;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`calendar-day ${other ? "other" : ""} ${d === today ? "today" : ""} ${c >= 5 ? "weekend" : ""}`}
                    onClick={(e) => ready && editable.length && setMenu({ x: e.clientX, y: e.clientY, day: d })}
                    aria-label={L(`${md(d)}，新增排程`, `${md(d)}, add item`)}
                  >
                    <span className="calendar-num">{+d.slice(8, 10)}</span>
                    {hidden[c] > 0 && <span className="calendar-more">{L(`還有 ${hidden[c]} 件`, `+${hidden[c]} more`)}</span>}
                  </button>
                );
              })}
              {Array.from({ length: 7 }, (_, c) => {
                const d = addDays(ws, c);
                const list = postsByDay.get(d);
                if (!list) return null;
                const left = list.filter((x) => x.status !== "posted").length;
                return (
                  <button
                    key={`post-${d}`}
                    type="button"
                    className={`calendar-posts ${left ? "" : "done"}`}
                    style={{ right: `calc(${((6 - c) / 7) * 100}% + 5px)` }}
                    title={list.map((x) => `${x.time} ${PLATFORM_LABEL[x.platform][0]}｜${postTitle(x) || x.target}`).join("\n")}
                    aria-label={L(`${md(d)} 有 ${list.length} 則發文`, `${list.length} posts on ${md(d)}`)}
                    onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, postDay: d })}
                  >
                    📣 {list.length}
                  </button>
                );
              })}
              {bars.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`calendar-bar ${b.kind} ${b.done ? "done" : ""} ${b.kind === "milestone" && !b.done && b.start < today ? "late" : ""} ${b.cont ? "cont" : ""} ${b.more ? "more" : ""}`}
                  style={{ left: `calc(${(b.col / 7) * 100}% + 3px)`, width: `calc(${(b.span / 7) * 100}% - 6px)`, top: `${28 + b.lane * 22}px`, ["--c" as string]: colorOf(b.projectId) }}
                  title={`${nameOf(b.projectId)}｜${b.time ? `${b.time} ` : ""}${b.title}（${b.start === b.end ? md(b.start) : `${md(b.start)}～${md(b.end)}`}）`}
                  onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, item: b })}
                >
                  {b.kind === "milestone" ? "◆ " : ""}
                  {b.time && !b.cont ? `${b.time} ` : ""}
                  {b.title}
                </button>
              ))}
            </div>
            <div className={`calendar-sum d-only ${sum.events + sum.milestones ? "" : "none"}`}>
              <b>{sum.events + sum.milestones}</b>
              <span>{sum.events + sum.milestones ? L(`${sum.events} 個排程${sum.milestones ? `・${sum.milestones} 個里程碑` : ""}`, `${sum.events} events${sum.milestones ? ` · ${sum.milestones} milestones` : ""}`) : L("沒有排程", "Nothing")}</span>
            </div>
            </div>
          );
        })}
      </div>

      <div className="calendar-legend">
        {live.map((p) => (
          <span key={p.id}><i style={{ background: colorOf(p.id) }} />{p.name}</span>
        ))}
      </div>

      {menu?.day && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={L("新增排程", "Add item")}>
          <EventForm
            projects={editable}
            initial={{ title: "", start: menu.day, end: menu.day, time: "", projectId: editable[0]?.id ?? "" }}
            pending={pending}
            submitLabel={L("新增", "Add")}
            onSubmit={(v) => run(() => addEventAction(v.projectId, v.title, v.start, v.end, v.time))}
          />
        </ContextMenu>
      )}
      {menu?.postDay && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={L("當天的發文", "Posts that day")}>
          <p className="ctx-title">📣 {L(`${md(menu.postDay)} 的發文`, `Posts on ${md(menu.postDay)}`)}</p>
          <ul className="calendar-post-list">
            {(postsByDay.get(menu.postDay) ?? []).map((x) => {
              const proj = projects.find((p) => p.id === x.project_id);
              return (
                <li key={x.id} className={x.status === "posted" ? "done" : ""}>
                  <i style={{ background: colorOf(x.project_id) }} aria-hidden />
                  <span>
                    <b>{x.time}</b> {L(...PLATFORM_LABEL[x.platform])}・{L(...STATUS_LABEL[x.status])}
                    <br />
                    {proj && <Link href={`/social?p=${proj.slug}&view=posts`}>{postTitle(x) || x.target || proj.name}</Link>}
                    {x.target && <span className="muted small"> {x.target}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </ContextMenu>
      )}
      {menu?.item && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} label={menu.item.title}>
          {menu.item.kind === "event" && editsProject(access, menu.item.projectId) ? (
            <>
              <EventForm
                projects={editable}
                initial={{ title: menu.item.title, start: menu.item.start, end: menu.item.end, time: menu.item.time ?? "", projectId: menu.item.projectId }}
                pending={pending}
                submitLabel={L("儲存", "Save")}
                onSubmit={(v) => run(() => updateEventAction(menu.item!.id, v))}
              />
              <hr />
              <button type="button" role="menuitem" className="danger" disabled={pending} onClick={() => run(() => deleteEventAction(menu.item!.id))}>
                {L("刪除這個排程", "Delete")}
              </button>
            </>
          ) : (
            <>
              <p className="ctx-title">{menu.item.kind === "milestone" ? `◆ ${L("里程碑", "Milestone")}` : L("排程", "Event")}・{nameOf(menu.item.projectId)}</p>
              <p className="calendar-ms-title">
                {menu.item.time ? `${menu.item.time} ` : ""}
                {menu.item.title}（{menu.item.start === menu.item.end ? md(menu.item.start) : `${md(menu.item.start)}～${md(menu.item.end)}`}）{menu.item.done ? L("・已完成", " · done") : ""}
              </p>
              {menu.item.kind === "milestone" && editsProject(access, menu.item.projectId) && <p className="ctx-sub">{L("里程碑在專案卡片上修改", "Edit milestones on the project card")}</p>}
              {projects.find((p) => p.id === menu.item!.projectId) && (
                <Link className="calendar-link" href={`/projects/${projects.find((p) => p.id === menu.item!.projectId)!.slug}`}>{L("看這個專案 ›", "Open project ›")}</Link>
              )}
            </>
          )}
        </ContextMenu>
      )}
    </section>
  );
}

type EventValue = { title: string; start: string; end: string; time: string; projectId: string };

function EventForm({
  projects,
  initial,
  pending,
  submitLabel,
  onSubmit,
}: {
  projects: Project[];
  initial: EventValue;
  pending: boolean;
  submitLabel: string;
  onSubmit: (v: EventValue) => void;
}) {
  const L = useL();
  const [v, setV] = useState(initial);
  return (
    <form
      className="calendar-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.title.trim()) onSubmit(v);
      }}
    >
      <input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={L("要做什麼？例如：封測第二輪", "What? e.g. Beta round 2")} maxLength={80} required autoFocus />
      <select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })} aria-label={L("專案", "Project")}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="calendar-dates">
        <input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value, end: v.end < e.target.value ? e.target.value : v.end })} aria-label={L("開始", "Start")} required />
        <span>～</span>
        <input type="date" value={v.end} min={v.start} onChange={(e) => setV({ ...v, end: e.target.value })} aria-label={L("結束", "End")} />
      </div>
      <label className="calendar-time">
        <span>{L("時間（選填）", "Time (optional)")}</span>
        <input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} aria-label={L("開始時間", "Start time")} />
        {v.time && <button type="button" className="btn ghost small" onClick={() => setV({ ...v, time: "" })}>{L("清除", "Clear")}</button>}
      </label>
      {v.time && <p className="muted small">{L("開始前 30 分鐘推送到手機 App", "Push to the phone app 30 min before")}</p>}
      <button type="submit" className="btn primary small" disabled={pending}>{pending ? L("處理中…", "Saving…") : submitLabel}</button>
    </form>
  );
}
