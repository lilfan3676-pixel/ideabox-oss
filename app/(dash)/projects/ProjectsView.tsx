"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { daysBetween } from "@/lib/dates";
import { FOLDER_COLORS } from "@/lib/folderLogic";
import { timeAgo } from "@/lib/format";
import { useL, useLang } from "@/app/LangProvider";
import { daysIdle, LINK_KINDS, LINK_LABEL, STALE_DAYS, type LogSource, type Milestone, type Project, type ProjectEvent, type ProjectLog } from "@/lib/projectLogic";
import { useView } from "../Nav";
import { useAccess } from "../AccessContext";
import { can, editsProject } from "@/lib/accessLogic";
import {
  addLog,
  addMilestoneAction,
  createProject,
  deleteMilestone,
  deleteProject,
  saveProjectSettings,
  syncSlackNow,
  setNextStep,
  setStage,
  toggleMilestone,
  type ProjectResult,
} from "./actions";
import { Schedule, type ActivityLog, type StageLog } from "./Schedule";
import { Calendar } from "./Calendar";
import type { Post } from "@/lib/postLogic";
import { ProjectLinks } from "./ProjectLinks";
import { projectInsights } from "@/lib/insights";
import { Delta, Kpi, KpiRow, SidePanel } from "../Insight";

// 左側列：專案卡片／月曆兩頁
const VIEWS = ["cards", "calendar"] as const;
const FILTERS = ["all", "active", "paused"] as const;
const PALETTE = Object.values(FOLDER_COLORS);
const SOURCE_ICON: Record<LogSource, string> = { manual: "✍️", telegram: "💬", claude: "🤖", github: "⬆️", slack: "📣", system: "⚙️" };

export function ProjectsView({
  projects,
  milestones,
  logs,
  stageLogs = [],
  activity = [],
  events = [],
  posts = [],
  eventsReady = false,
  today,
  now,
  order,
}: {
  projects: Project[];
  order?: string[]; // 全部專案的順序（合夥人只拿到部分專案時，顏色照全部的順序，跟你看到的一樣）
  milestones: Milestone[];
  logs: ProjectLog[];
  stageLogs?: StageLog[]; // 全部的「階段：A → B」日誌（時程表還原階段用）
  activity?: ActivityLog[]; // 最近一年每筆日誌的時間（時程表的活動量小點）
  events?: ProjectEvent[]; // 排程（月曆）
  posts?: Post[]; // 發文排程（月曆上的 📣）
  eventsReady?: boolean; // 還沒執行 migration-015 時是 false
  today: string; // 台北日期，由伺服器提供
  now: number;
}) {
  const access = useAccess();
  const views = VIEWS.filter((v) => (v === "calendar" ? can(access, "calendar") : can(access, "projects")));
  const view = useView(views[0] ?? "cards", views);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const L = useL();
  const [notice, setNotice] = useState<{ text: string; ok?: boolean } | null>(null);
  const [syncing, startSync] = useTransition();
  // 月曆／時程表，記住上次選的
  const [plan, setPlan] = useState<"calendar" | "gantt">("calendar");
  useEffect(() => {
    try {
      if (localStorage.getItem("ib-projects-plan") === "gantt") setPlan("gantt");
    } catch {
      /* 存不了就用預設 */
    }
  }, []);
  const pickPlan = (v: "calendar" | "gantt") => {
    setPlan(v);
    try {
      localStorage.setItem("ib-projects-plan", v);
    } catch {
      /* 無痕模式等 */
    }
  };
  const ids = order ?? projects.map((p) => p.id);
  const colorOf = (id: string) => PALETTE[Math.max(0, ids.indexOf(id)) % PALETTE.length];

  const list = projects.filter((p) => (filter === "active" ? p.status === "active" : filter === "paused" ? p.status !== "active" : true));
  // 月曆、時程表看所有沒完成的專案
  const live = projects.filter((p) => p.status !== "done");
  const activeCount = projects.filter((p) => p.status === "active").length;
  // 超過幾天沒動的專案：直接列名字（點了進專案頁），最久沒動的排前面
  const stale = projects
    .filter((p) => p.status === "active" && daysIdle(p, now) >= STALE_DAYS)
    .map((p) => ({ p, days: daysIdle(p, now) }))
    .sort((a, b) => b.days - a.days);

  // 最上面那排重點數字與右欄（電腦版）
  const pin = useMemo(() => projectInsights(projects, milestones, activity, today, now), [projects, milestones, activity, today, now]);
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const lang = useLang();
  const slackButton = access.owner ? (
    <button
      type="button"
      className="btn small"
      disabled={syncing}
      onClick={() => startSync(async () => setNotice(await syncSlackNow().catch(() => ({ ok: false, text: L("讀取失敗", "Failed") }))))}
    >
      {syncing ? L("讀取中…", "Reading…") : L("立即讀取 Slack", "Read Slack now")}
    </button>
  ) : null;

  // 伺服器動作失敗時跳提示；成功時頁面會自己更新
  const report = (r: ProjectResult) => {
    if (!r.ok) setNotice({ text: r.error ?? L("沒有存成功，請再試一次", "Couldn’t save — please try again") });
  };

  return (
    <>
      {/* 電腦版：重點數字卡；手機版照舊用下面的標題列 */}
      <KpiRow label={L("重點數字", "Key numbers")}>
        <Kpi pop label={L("進行中", "Active")} value={pin.active} hint={L(`暫停／完成 ${pin.paused}`, `${pin.paused} paused / done`)} />
        <Kpi
          label={L("本週工作日誌", "Logs this week")}
          value={pin.logsWeek}
          hint={<><Delta now={pin.logsWeek} prev={pin.logsLastWeek} flat={L("跟上週一樣", "Same as last week")} />{pin.logsWeek !== pin.logsLastWeek ? L(" 比上週", " vs last week") : ""}</>}
          data={pin.weekly}
        />
        <Kpi
          tone={pin.overdue ? "warn" : ""}
          label={L("接下來的里程碑", "Upcoming milestones")}
          value={pin.upcoming.length}
          hint={
            pin.overdue
              ? L(`另外有 ${pin.overdue} 個已經過期`, `${pin.overdue} overdue`)
              : pin.upcoming[0]
                ? L(`最近：${pin.upcoming[0].days === 0 ? "今天" : `${pin.upcoming[0].days} 天後`} ${pin.upcoming[0].title}`, `Next: ${pin.upcoming[0].days}d · ${pin.upcoming[0].title}`)
                : L("沒有排定的里程碑", "Nothing scheduled")
          }
        />
        <Kpi
          tone={stale.length ? "warn" : ""}
          label={L(`超過 ${STALE_DAYS} 天沒動`, `Idle ${STALE_DAYS}+ days`)}
          value={stale.length}
          hint={stale.length ? stale.map(({ p, days }) => L(`${p.name}（${days} 天）`, `${p.name} (${days}d)`)).join(L("、", ", ")) : L("每個專案最近都有動", "Everything is moving")}
        />
      </KpiRow>
      <div className="page-title with-action m-only">
        <div>
        <h1>{L("專案", "Projects")}</h1>
        <p className="muted title-stats">
          <span>{L(`進行中 ${activeCount}`, `${activeCount} active`)}</span>
          <span>{L(`全部 ${projects.length}`, `${projects.length} total`)}</span>
          {stale.length > 0 && (
            <span className="warn-text">
              💤 {L("沒動：", "Idle: ")}
              {stale.map(({ p, days }, i) => (
                <span key={p.id}>
                  {i > 0 && L("、", ", ")}
                  <Link href={`/projects/${p.slug}`} className="warn-text stale-link">{p.name}</Link>
                  {L(`（${days} 天）`, ` (${days}d)`)}
                </span>
              ))}
            </span>
          )}
        </p>
        </div>
        {/* 平常每 5 分鐘自動讀；這顆按鈕馬上讀一次，順便檢查頻道有沒有設定好 */}
        {slackButton && <div className="title-actions">{slackButton}</div>}
      </div>

      {view === "calendar" ? (
        <>
          <div className="view-line">
          <div className="seg plan-switch" role="group" aria-label={L("檢視方式", "View")}>
            <button type="button" className={plan === "calendar" ? "active" : ""} aria-pressed={plan === "calendar"} onClick={() => pickPlan("calendar")}>{L("月曆", "Calendar")}</button>
            <button type="button" className={plan === "gantt" ? "active" : ""} aria-pressed={plan === "gantt"} onClick={() => pickPlan("gantt")}>{L("時程表", "Timeline")}</button>
          </div>
          <span className="push d-only">{slackButton}</span>
          </div>
          {/* 換月曆／時程表時淡入 */}
          <div className="view-swap" key={plan}>
            {plan === "calendar" ? (
              <Calendar projects={live} events={events} milestones={milestones} posts={posts} ready={eventsReady} today={today} colorOf={colorOf} report={(r) => (r.ok ? setNotice(null) : report(r))} />
            ) : (
              <Schedule projects={live} milestones={milestones} stageLogs={stageLogs} activity={activity} today={today} now={now} colorOf={colorOf} />
            )}
          </div>
        </>
      ) : (
        <div className="page-split">
          <div className="page-main">
          <div className="seg plan-switch" role="group" aria-label={L("篩選", "Filter")}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={filter === f ? "active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? L("全部", "All") : f === "active" ? L("進行中", "Active") : L("暫停／完成", "Paused / done")}
              </button>
            ))}
          </div>
          <div className="project-grid stagger" key={filter}>
            {list.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                color={colorOf(p.id)}
                milestones={milestones.filter((m) => m.project_id === p.id)}
                logs={logs.filter((l) => l.project_id === p.id)}
                today={today}
                now={now}
                report={report}
              />
            ))}
            {filter !== "paused" && access.owner && <NewProject report={report} />}
          </div>
          </div>
          <aside className="page-aside d-only" aria-label={L("專案概況", "Project overview")}>
            <SidePanel title={L("里程碑", "Milestones")} action={can(access, "calendar") ? <Link href="/projects?view=calendar" className="small">{L("看月曆", "Calendar")}</Link> : undefined}>
              {pin.upcoming.length ? pin.upcoming.slice(0, 6).map((m) => (
                <div className="side-row" key={m.id}>
                  <b className="side-date">{+m.due.slice(5, 7)}/{+m.due.slice(8, 10)}</b>
                  <span className="grow">
                    <span className="side-title">{m.title}</span>
                    <span className="muted small">{nameOf(m.project_id)}・{m.days === 0 ? L("今天", "today") : L(`${m.days} 天後`, `in ${m.days}d`)}</span>
                  </span>
                </div>
              )) : <p className="muted small">{L("沒有排定的里程碑", "Nothing scheduled")}</p>}
            </SidePanel>
            <SidePanel title={L("最新日誌", "Latest logs")} action={slackButton ?? undefined}>
              {logs.length ? logs.slice(0, 5).map((l) => (
                <div className="side-row" key={l.id}>
                  <span className="grow">
                    <span className="side-title clamp">{l.text}</span>
                    <span className="muted small">{nameOf(l.project_id)}・{timeAgo(l.at, now, lang)}</span>
                  </span>
                </div>
              )) : <p className="muted small">{L("還沒有日誌", "No logs yet")}</p>}
            </SidePanel>
          </aside>
        </div>
      )}

      {notice && typeof document !== "undefined" && createPortal(
        <div className={`toast glass ${notice.ok ? "ok" : "bad"}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden>{notice.ok ? "✓" : "!"}</span>
          <div className="toast-body"><b>{notice.text}</b></div>
          <button type="button" className="toast-close" aria-label={L("關閉通知", "Dismiss")} onClick={() => setNotice(null)}>×</button>
        </div>,
        document.body,
      )}
    </>
  );
}


// ---------- 專案卡片 ----------

function ProjectCard({
  project: p,
  color,
  milestones,
  logs,
  today,
  now,
  report,
}: {
  project: Project;
  color: string;
  milestones: Milestone[];
  logs: ProjectLog[];
  today: string;
  now: number;
  report: (r: ProjectResult) => void;
}) {
  const L = useL();
  const lang = useLang();
  const [editingNext, setEditingNext] = useState(false);
  const [settings, setSettings] = useState(false);
  const [allLogs, setAllLogs] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ProjectResult>) => start(async () => report(await fn().catch(() => ({ ok: false }))));
  const access = useAccess();
  const owner = access.owner; // 階段、下一步、設定只有你能改
  const edit = editsProject(access, p.id); // 里程碑、日誌：你和「可編輯」的合夥人

  const idle = daysIdle(p, now);
  const stale = p.status === "active" && idle >= STALE_DAYS;
  const openMs = milestones.filter((m) => !m.done);
  const doneMs = milestones.filter((m) => m.done);
  const shownLogs = allLogs ? logs.slice(0, 50) : logs.slice(0, 4);

  if (settings) return <ProjectSettings project={p} color={color} onClose={() => setSettings(false)} report={report} />;

  return (
    <article className={`glass project-card ${p.status !== "active" ? "dim" : ""} ${pending ? "busy" : ""}`} style={{ ["--c" as string]: color }}>
      <header className="project-head">
        <span className="project-dot" aria-hidden />
        <h2><Link href={`/projects/${p.slug}`} className="project-link" title={L("看詳細頁", "Open details")}>{p.name} ›</Link></h2>
        {p.status !== "active" && <span className="badge">{p.status === "paused" ? L("暫停", "Paused") : L("完成", "Done")}</span>}
        <span className={`muted small push ${stale ? "warn-text" : ""}`} title={L("最後一次更新", "Last update")}>
          {stale ? "💤 " : ""}
          {idle <= 0 ? L("今天有更新", "Updated today") : L(`${idle} 天前更新`, `Updated ${idle}d ago`)}
        </span>
        {owner && <button type="button" className="btn ghost small" onClick={() => setSettings(true)}>{L("設定", "Settings")}</button>}
      </header>
      <ProjectLinks links={p.links} onEmpty={owner ? () => setSettings(true) : undefined} />

      {/* 階段：點一下就切換 */}
      <ol className="stage-steps" aria-label={L("階段", "Stages")}>
        {p.stages.map((s, n) => (
          <li key={s} className={n < p.stage ? "past" : n === p.stage ? "now" : ""}>
            <button
              type="button"
              disabled={pending || n === p.stage || !owner}
              aria-current={n === p.stage ? "step" : undefined}
              title={n === p.stage ? L("目前階段", "Current stage") : L(`切換到「${s}」`, `Move to “${s}”`)}
              onClick={() => run(() => setStage(p.id, n))}
            >
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="project-next">
        <span className="project-label">{L("下一步", "Next step")}</span>
        {editingNext ? (
          <form
            className="inline-edit"
            action={(fd) => {
              setEditingNext(false);
              run(() => setNextStep(p.id, String(fd.get("next") ?? "")));
            }}
          >
            <input name="next" defaultValue={p.next_step ?? ""} autoFocus maxLength={200} onKeyDown={(e) => e.key === "Escape" && setEditingNext(false)} />
            <button className="btn small primary" type="submit">{L("儲存", "Save")}</button>
          </form>
        ) : (
          <button type="button" className="next-text" disabled={!owner} onClick={() => setEditingNext(true)} title={owner ? L("點一下修改", "Click to edit") : undefined}>
            {p.next_step ? `👉 ${p.next_step}` : <span className="muted">{L("＋ 寫下一步要做什麼", "+ Write the next step")}</span>}
          </button>
        )}
      </div>

      <div className="project-section">
        <span className="project-label">{L("里程碑", "Milestones")}</span>
        <ul className="ms-list">
          {openMs.map((m) => {
            const days = daysBetween(today, m.due);
            return (
              <li key={m.id} className={days < 0 ? "overdue" : days <= 7 ? "soon" : ""}>
                <input type="checkbox" checked={false} disabled={pending || !edit} onChange={() => run(() => toggleMilestone(m.id))} aria-label={L(`完成「${m.title}」`, `Complete “${m.title}”`)} />
                <span className="ms-title">{m.title}</span>
                <span className="ms-due">
                  {m.due.slice(5).replace("-", "/")}・{days < 0 ? L(`過期 ${-days} 天`, `${-days}d overdue`) : days === 0 ? L("今天", "today") : L(`${days} 天後`, `in ${days}d`)}
                </span>
                {edit && <button type="button" className="ms-del" aria-label={L("刪除里程碑", "Delete milestone")} onClick={() => window.confirm(L(`刪除「${m.title}」？`, `Delete “${m.title}”?`)) && run(() => deleteMilestone(m.id))}>×</button>}
              </li>
            );
          })}
          {showDone &&
            doneMs.map((m) => (
              <li key={m.id} className="done">
                <input type="checkbox" checked disabled={pending || !edit} onChange={() => run(() => toggleMilestone(m.id))} aria-label={L(`取消完成「${m.title}」`, `Reopen “${m.title}”`)} />
                <span className="ms-title">{m.title}</span>
                <span className="ms-due">{m.due.slice(5).replace("-", "/")}</span>
              </li>
            ))}
        </ul>
        {doneMs.length > 0 && (
          <button type="button" className="link-btn small" onClick={() => setShowDone(!showDone)}>
            {showDone ? L("收起已完成", "Hide completed") : L(`已完成 ${doneMs.length} 個`, `${doneMs.length} completed`)}
          </button>
        )}
        {edit && <form
          className="ms-add"
          action={(fd) => run(() => addMilestoneAction(p.id, String(fd.get("title") ?? ""), String(fd.get("due") ?? "")))}
        >
          <input name="due" type="date" min={today} required aria-label={L("日期", "Date")} />
          <input name="title" required maxLength={80} placeholder={L("新增里程碑，例如：正式上架", "New milestone, e.g. Launch")} />
          <button className="btn small" type="submit" disabled={pending}>{L("加入", "Add")}</button>
        </form>}
      </div>

      <div className="project-section">
        <span className="project-label">{L("工作日誌", "Work log")}</span>
        {edit && <form
          className="log-add"
          action={(fd) => {
            const t = String(fd.get("text") ?? "").trim();
            if (t) run(() => addLog(p.id, t));
          }}
          key={logs[0]?.id ?? 0} // 新增成功後清空輸入框
        >
          <input name="text" maxLength={500} placeholder={L("今天做了什麼？", "What did you do today?")} />
          <button className="btn small" type="submit" disabled={pending}>{L("記錄", "Log")}</button>
        </form>}
        {shownLogs.length ? (
          <ul className="log-list">
            {shownLogs.map((l) => (
              <li key={l.id}>
                <span aria-hidden title={l.source}>{SOURCE_ICON[l.source] ?? "•"}</span>
                <span className="log-text">{l.text}</span>
                <time className="muted small" dateTime={l.at}>{timeAgo(l.at, now, lang)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{L("還沒有紀錄。之後用 Claude Code 做事會自動記在這裡。", "Nothing yet. Work done with Claude Code will show up here automatically later.")}</p>
        )}
        {logs.length > 4 && (
          <button type="button" className="link-btn small" onClick={() => setAllLogs(!allLogs)}>
            {allLogs ? L("收起", "Show less") : L(`看全部 ${logs.length} 筆`, `Show all ${logs.length}`)}
          </button>
        )}
      </div>
    </article>
  );
}

function ProjectSettings({ project: p, color, onClose, report }: { project: Project; color: string; onClose: () => void; report: (r: ProjectResult) => void }) {
  const L = useL();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <article className="glass project-card editing" style={{ ["--c" as string]: color }}>
      <header className="project-head">
        <span className="project-dot" aria-hidden />
        <h2>{L(`${p.name} 的設定`, `${p.name} settings`)}</h2>
      </header>
      <form
        className="project-form"
        onSubmit={(e) => {
          // 不用 action：React 送出後會把欄位清回原值，存失敗時你打的東西就不見了
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await saveProjectSettings(p.id, {
              name: String(fd.get("name") ?? ""),
              slug: String(fd.get("slug") ?? ""),
              stages: String(fd.get("stages") ?? ""),
              folder: String(fd.get("folder") ?? ""),
              repo: String(fd.get("repo") ?? ""),
              status: String(fd.get("status") ?? ""),
              description: String(fd.get("description") ?? ""),
              slack: String(fd.get("slack") ?? ""),
              links: Object.fromEntries(LINK_KINDS.map((k) => [k, String(fd.get(`link-${k}`) ?? "")])),
            }).catch(() => ({ ok: false }) as ProjectResult);
            if (r.ok) onClose();
            else setErr(r.error ?? L("沒有存成功", "Couldn’t save"));
          });
        }}
      >
        <label>{L("名稱", "Name")}<input name="name" defaultValue={p.name} required maxLength={40} /></label>
        <label>
          {L("一句話描述", "One-line description")}
          <textarea name="description" rows={2} defaultValue={p.description ?? ""} maxLength={2000} />
          <span className="muted small">{L("AI 分析這個專案的點子時會參考", "Used by AI when analyzing ideas for this project")}</span>
        </label>
        <label>
          {L("短名（Telegram 指令用）", "Short name (for Telegram)")}
          <input name="slug" defaultValue={p.slug} required maxLength={20} pattern="[a-zA-Z0-9-]+" />
          <span className="muted small">{L(`例如傳「${p.slug} 下一步 ＿＿」給 Bot`, `e.g. send “${p.slug} 下一步 …” to the bot`)}</span>
        </label>
        <fieldset className="project-links-form">
          <legend>{L("官網與社群連結（沒填的會顯示淡淡的圖示）", "Website & social links (empty ones show as faded icons)")}</legend>
          {LINK_KINDS.map((k) => (
            <label key={k}>
              {L(...LINK_LABEL[k])}
              <input name={`link-${k}`} type="text" inputMode="url" defaultValue={p.links?.[k] ?? ""} placeholder="https://" maxLength={300} />
            </label>
          ))}
        </fieldset>
        <label>
          {L("Slack 頻道", "Slack channel")}
          <input name="slack" defaultValue={p.slack_channel ?? ""} maxLength={80} placeholder={`progress-${p.slug}`} />
          <span className="muted small">{L(`空著就讀 #progress-${p.slug}`, `Leave blank to read #progress-${p.slug}`)}</span>
        </label>
        <label>
          {L("階段（用逗號或換行分隔，依順序）", "Stages (comma or line separated, in order)")}
          <textarea name="stages" rows={3} defaultValue={p.stages.join("、")} required />
        </label>
        <label>
          {L("狀態", "Status")}
          <select name="status" defaultValue={p.status}>
            <option value="active">{L("進行中", "Active")}</option>
            <option value="paused">{L("暫停（不提醒）", "Paused (no reminders)")}</option>
            <option value="done">{L("完成", "Done")}</option>
          </select>
        </label>
        <label>
          {L("電腦上的資料夾名稱", "Folder name on your Mac")}
          <input name="folder" defaultValue={p.folder ?? ""} maxLength={80} placeholder="my-app" />
          <span className="muted small">{L("之後 Claude Code 自動回報時，用這個認出是哪個專案", "Used later to match Claude Code activity to this project")}</span>
        </label>
        <label>
          GitHub repo
          <input name="repo" defaultValue={p.repo ?? ""} maxLength={100} placeholder="owner/name" />
        </label>
        {err && <p className="error small">{err}</p>}
        <div className="actions">
          <button
            type="button"
            className="btn ghost small push-left danger-text"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(L(`確定刪除「${p.name}」？里程碑和工作日誌會一起刪掉，不能復原。只是先不做的話，改成「暫停」就好。`, `Delete “${p.name}”? Its milestones and log go with it and can’t be restored. To set it aside, choose Paused instead.`))) return;
              start(async () => report(await deleteProject(p.id).catch(() => ({ ok: false }))));
            }}
          >
            {L("刪除專案", "Delete project")}
          </button>
          <button type="button" className="btn ghost small" onClick={onClose}>{L("取消", "Cancel")}</button>
          <button type="submit" className="btn small primary" disabled={pending}>{pending ? L("儲存中…", "Saving…") : L("儲存", "Save")}</button>
        </div>
      </form>
    </article>
  );
}

function NewProject({ report }: { report: (r: ProjectResult) => void }) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button type="button" className="glass project-card project-new" onClick={() => setOpen(true)}>
        <span aria-hidden>＋</span>
        {L("新增專案", "New project")}
      </button>
    );
  }
  return (
    <article className="glass project-card editing">
      <form
        className="project-form"
        action={(fd) =>
          start(async () => {
            const r = await createProject(String(fd.get("name") ?? ""), String(fd.get("stages") ?? "")).catch(() => ({ ok: false }) as ProjectResult);
            report(r);
            if (r.ok) setOpen(false);
          })
        }
      >
        <label>{L("專案名稱", "Project name")}<input name="name" required maxLength={40} autoFocus /></label>
        <label>
          {L("階段（逗號分隔，可以先空著）", "Stages (comma separated, optional)")}
          <input name="stages" placeholder={L("構想、開發、上線、維運", "Idea, Build, Launch, Maintain")} />
        </label>
        <div className="actions">
          <button type="button" className="btn ghost small push-left" onClick={() => setOpen(false)}>{L("取消", "Cancel")}</button>
          <button type="submit" className="btn small primary" disabled={pending}>{L("建立", "Create")}</button>
        </div>
      </form>
    </article>
  );
}

