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

export function GrantsView({ all, today, msg }: { all: Grant[]; today: string; msg?: string }) {
  const view = useView("all", VIEWS);
  const L = useL();
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

  return (
    <>
      <div className="page-title with-action">
        <div>
          <h1>{L("補助雷達", "Grant radar")}</h1>
          <p className="muted">
            {viewLabel(L)[view]}・{L(`${list.length} 筆`, `${list.length} items`)}{soonCount ? L(`・${soonCount} 筆 14 天內截止`, `・${soonCount} due within 14 days`) : ""}
          </p>
        </div>
        <form action={runRadarNow}>
          <SubmitButton label={L("立即搜尋", "Search now")} pending={L("搜尋中（約 1～3 分鐘）…", "Searching (about 1–3 min)…")} className="btn primary" />
        </form>
      </div>
      <p className="muted small hint">{L("每週日晚上自動搜尋；截止前 14 天、3 天會在 Telegram 提醒（只提醒「新的」「有興趣」）。", "Searches automatically every Sunday night. Telegram reminders go out 14 and 3 days before a deadline (only for \"New\" and \"Interested\").")}</p>
      {msg && <p className="notice glass">{msg}</p>}

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
    </>
  );
}

function GrantRow({ g, today }: { g: Grant; today: string }) {
  const days = g.deadline ? daysBetween(today, g.deadline) : null;
  const L = useL();
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
        <div className="grant-controls">
          <form action={setGrantStatus}>
            <input type="hidden" name="id" value={g.id} />
            <AutoSelect name="status" defaultValue={g.status} options={statusOptions(L)} />
          </form>
          <form action={deleteGrant}>
            <input type="hidden" name="id" value={g.id} />
            <ConfirmButton label={L("刪除", "Delete")} message={L("確定刪除？下次搜尋若再找到會重新出現。", "Delete this? It will come back if the next search finds it again.")} />
          </form>
        </div>
      </div>
    </li>
  );
}
