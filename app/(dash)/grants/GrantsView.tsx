"use client";

import { useMemo } from "react";
import { useL } from "@/app/LangProvider";
import { daysBetween } from "@/lib/dates";
import type { Translate } from "@/lib/i18n";
import type { Grant } from "@/lib/db";
import { deleteGrant, runRadarNow, setGrantStatus } from "../actions";
import { AutoSelect, ConfirmButton, SubmitButton } from "../ConfirmButton";
import { IconArrowUpRight } from "../icons";
import { useView } from "../Nav";
import { useAccess } from "../AccessContext";
import { grantInsights, HIGH_FIT } from "@/lib/insights";
import { BarRow, Kpi, KpiRow, SidePanel } from "../Insight";

const statusOptions = (L: Translate): Array<[Grant["status"], string]> => [
  ["new", L("新的", "New")],
  ["interested", L("有興趣", "Interested")],
  ["applied", L("已申請", "Applied")],
  ["ignored", L("不適合", "Not a fit")],
];

const VIEWS = ["all", "soon", "rolling", "closed"] as const;
const viewLabel = (L: Translate): Record<string, string> => ({
  all: L("全部開放中", "All open"),
  soon: L("30 天內截止", "Due within 30 days"),
  rolling: L("常態受理／未公布截止日", "Rolling / no deadline announced"),
  closed: L("已截止或標記不適合", "Closed or marked not a fit"),
});

export function GrantsView({ all, today, msg, now }: { all: Grant[]; today: string; msg?: string; now: number }) {
  const view = useView("all", VIEWS);
  const L = useL();
  const owner = useAccess().owner;
  const { list, soonCount } = useMemo(() => {
    const isOpen = (g: Grant) => g.status !== "ignored" && (!g.deadline || g.deadline >= today);
    const open = all.filter(isOpen);
    const list =
      view === "soon"
        ? open.filter((g) => g.deadline && daysBetween(today, g.deadline) <= 30)
        : view === "rolling"
          ? open.filter((g) => !g.deadline)
          : view === "closed"
            ? all.filter((g) => !isOpen(g))
            : open;
    return { list, soonCount: open.filter((g) => g.deadline && daysBetween(today, g.deadline) <= 14).length };
  }, [all, today, view]);
  // 最上面那排重點數字與右欄（電腦版）
  const ins = useMemo(() => grantInsights(all, today, now), [all, today, now]);
  const searchButton = owner ? (
    <form action={runRadarNow}>
      <SubmitButton label={L("立即搜尋", "Search now")} pending={L("搜尋中（約 1～3 分鐘）…", "Searching (about 1–3 min)…")} className="btn primary" />
    </form>
  ) : null;
  const statusMax = Math.max(ins.byStatus.new, ins.byStatus.interested, ins.byStatus.applied, 1);

  return (
    <>
      {/* 電腦版：重點數字卡；手機版照舊用下面的標題列 */}
      <KpiRow label={L("重點數字", "Key numbers")}>
        <Kpi pop tone={ins.due3 ? "danger" : ""} label={L("3 天內截止", "Due in 3 days")} value={ins.due3} hint={ins.due3 ? L("今天就要處理", "Handle these today") : L("沒有馬上要截止的", "Nothing urgent")} />
        <Kpi tone={ins.due14 ? "warn" : ""} label={L("14 天內截止", "Due in 14 days")} value={ins.due14} hint={L("已申請的不算", "Excludes ones you applied to")} />
        <Kpi label={L("這週新找到", "Found this week")} value={ins.newWeek} hint={L(`開放中共 ${ins.open} 筆`, `${ins.open} open in total`)} />
        <Kpi label={L(`適合度 ${HIGH_FIT} 分以上`, `Fit ${HIGH_FIT}+`)} value={ins.highFit} hint={L("照你的專案描述比對", "Matched against your project description")} />
      </KpiRow>
      <div className="view-line d-only">
        <h2>{viewLabel(L)[view]}</h2>
        <span className="muted small">{L(`${list.length} 筆`, `${list.length} items`)}</span>
        <span className="push">{searchButton}</span>
      </div>
      <div className="page-title with-action m-only">
        <div>
          <h1>{L("補助雷達", "Grant radar")}</h1>
          <p className="muted">
            {viewLabel(L)[view]}・{L(`${list.length} 筆`, `${list.length} items`)}{soonCount ? L(`・${soonCount} 筆 14 天內截止`, `・${soonCount} due within 14 days`) : ""}
          </p>
        </div>
        {searchButton}
      </div>
      <p className="muted small hint">{L("每週日晚上自動搜尋；截止前 14 天、3 天會在 Telegram 提醒（只提醒「新的」「有興趣」）。", "Searches automatically every Sunday night. Telegram reminders go out 14 and 3 days before a deadline (only for \"New\" and \"Interested\").")}</p>
      {msg && <p className="notice glass">{msg}</p>}

      <div className="page-split">
      <div className="page-main">
      {!list.length && (
        <div className="glass empty">
          {all.length ? L("這個檢視下沒有資料。", "Nothing in this view.") : L("目前沒有資料，按「立即搜尋」跑第一次。", "No data yet. Click \"Search now\" to run the first search.")}
        </div>
      )}

      <ul className={`grants stagger ${view === "closed" ? "dim" : ""}`} key={view}>
        {list.map((g) => (
          <GrantRow key={g.id} g={g} today={today} />
        ))}
      </ul>
      </div>
      <aside className="page-aside d-only" aria-label={L("補助概況", "Grant overview")}>
        <SidePanel title={L("截止時間軸", "Deadlines")}>
          {ins.timeline.length ? ins.timeline.slice(0, 6).map((g) => (
            <div className="side-row" key={g.id}>
              <b className={`side-date ${g.days <= 3 ? "danger" : g.days <= 14 ? "warn" : ""}`}>{+g.deadline.slice(5, 7)}/{+g.deadline.slice(8, 10)}</b>
              <span className="grow">
                <span className="side-title">{g.name}</span>
                <span className="muted small">{g.days === 0 ? L("今天截止", "Due today") : L(`剩 ${g.days} 天`, `${g.days} days left`)}</span>
              </span>
            </div>
          )) : <p className="muted small">{L("沒有要追的截止日", "No deadlines to chase")}</p>}
        </SidePanel>
        <SidePanel title={L("處理進度", "Progress")}>
          <BarRow label={L("新的", "New")} n={ins.byStatus.new} max={statusMax} />
          <BarRow label={L("有興趣", "Interested")} n={ins.byStatus.interested} max={statusMax} />
          <BarRow label={L("已申請", "Applied")} n={ins.byStatus.applied} max={statusMax} />
        </SidePanel>
      </aside>
      </div>
    </>
  );
}

function GrantRow({ g, today }: { g: Grant; today: string }) {
  const days = g.deadline ? daysBetween(today, g.deadline) : null;
  const L = useL();
  const owner = useAccess().owner;
  const urgency = days === null ? "" : days < 0 ? "past" : days <= 3 ? "urgent" : days <= 14 ? "soon" : "";
  return (
    <li className={`glass grant lift ${urgency}`}>
      <div className="grant-main">
        <div className="grant-title">
          {g.url ? (
            <a href={g.url} target="_blank" rel="noreferrer noopener" className="ext-link">
              {g.name} <IconArrowUpRight size={14} />
            </a>
          ) : (
            g.name
          )}
        </div>
        <div className="muted small">{[g.organizer, g.amount].filter(Boolean).join("・")}</div>
        {g.eligibility && <div className="small">{L("資格：", "Eligibility: ")}{g.eligibility}</div>}
        {g.fit_reason && <div className="small">💡 {g.fit_reason}</div>}
      </div>
      <div className="grant-side">
        <div className={`deadline ${urgency}`}>
          <b>{g.deadline ? (days! < 0 ? L("已截止", "Closed") : days === 0 ? L("今天截止", "Due today") : L(`剩 ${days} 天`, `${days} days left`)) : L("常態受理", "Rolling")}</b>
          {g.deadline && <span className="muted small">{g.deadline}</span>}
        </div>
        {g.fit_score !== null && <div className="fit">{L("適合度", "Fit")} {g.fit_score}</div>}
        {owner && <div className="grant-controls">
          <form action={setGrantStatus}>
            <input type="hidden" name="id" value={g.id} />
            <AutoSelect name="status" defaultValue={g.status} options={statusOptions(L)} />
          </form>
          <form action={deleteGrant}>
            <input type="hidden" name="id" value={g.id} />
            <ConfirmButton label={L("刪除", "Delete")} message={L("確定刪除？下次搜尋若再找到會重新出現。", "Delete this? It will come back if the next search finds it again.")} />
          </form>
        </div>}
      </div>
    </li>
  );
}
