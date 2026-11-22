"use client";

import { useState, useTransition } from "react";
import { useL } from "@/app/LangProvider";
import { daysBetween } from "@/lib/dates";
import { groupTodos } from "@/lib/insights";
import type { Milestone } from "@/lib/projectLogic";
import { addMilestoneAction, deleteMilestone, toggleMilestone, type ProjectResult } from "./actions";

// 一個專案的待辦清單（總覽頁展開的那一塊、詳細頁共用）：
// 快到期的永遠看得到；還早的、沒訂日期的只先列幾件，其他收起來，才不會一打開就是一長串。

export function TodoRow({
  m,
  today,
  disabled,
  onToggle,
  onDelete,
  prefix,
}: {
  m: Milestone;
  today: string;
  disabled?: boolean;
  onToggle?: () => void;
  onDelete?: () => void;
  prefix?: React.ReactNode; // 總覽頁「現在要注意的」放專案名稱
}) {
  const L = useL();
  const days = m.due ? daysBetween(today, m.due) : null;
  const tone = m.done || days === null ? "" : days < 0 ? "overdue" : days <= 7 ? "soon" : "";
  return (
    <li className={`todo-row ${tone} ${m.done ? "done" : ""}`}>
      <input
        type="checkbox"
        checked={m.done}
        disabled={disabled || !onToggle}
        onChange={onToggle}
        aria-label={m.done ? L(`取消完成「${m.title}」`, `Reopen “${m.title}”`) : L(`完成「${m.title}」`, `Complete “${m.title}”`)}
      />
      {prefix}
      <span className="todo-title">{m.title}</span>
      {m.due && days !== null && (
        <span className="todo-due">
          {+m.due.slice(5, 7)}/{+m.due.slice(8, 10)}
          {!m.done && <>・{days < 0 ? L(`過期 ${-days} 天`, `${-days}d overdue`) : days === 0 ? L("今天", "today") : L(`${days} 天後`, `in ${days}d`)}</>}
        </span>
      )}
      {onDelete && !m.done && (
        <button type="button" className="ms-del" aria-label={L("刪除待辦", "Delete to-do")} onClick={() => window.confirm(L(`刪除「${m.title}」？`, `Delete “${m.title}”?`)) && onDelete()}>×</button>
      )}
    </li>
  );
}

export function TodoList({
  projectId,
  milestones,
  today,
  edit,
  report,
  rest = 5,
  maxUrgent,
}: {
  projectId: string;
  milestones: Milestone[];
  today: string;
  edit: boolean; // 你和「可編輯」的合夥人
  report: (r: ProjectResult) => void;
  rest?: number; // 不急的待辦先列幾件
  maxUrgent?: number; // 快到期的最多先列幾件（總覽頁展開時用，才不會一打開又是一長串）；沒給＝全部列
}) {
  const L = useL();
  const [more, setMore] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ProjectResult>) => start(async () => report(await fn().catch(() => ({ ok: false }))));
  const g = groupTodos(milestones, today);
  const calm = [...g.later, ...g.someday];
  const urgent = more || !maxUrgent ? g.urgent : g.urgent.slice(0, maxUrgent);
  // 快到期的還沒列完時，不急的先不列
  const room = more ? calm.length : urgent.length < g.urgent.length ? 0 : rest;
  const shown = calm.slice(0, room);
  const hidden = g.urgent.length - urgent.length + calm.length - shown.length;
  const row = (m: Milestone) => (
    <TodoRow key={m.id} m={m} today={today} disabled={pending} onToggle={edit ? () => run(() => toggleMilestone(m.id)) : undefined} onDelete={edit ? () => run(() => deleteMilestone(m.id)) : undefined} />
  );

  return (
    <div className={`todos ${pending ? "busy" : ""}`}>
      {g.urgent.length > 0 && (
        <>
          <p className="todo-group urgent">{L("過期・這週到期", "Overdue · due this week")}</p>
          <ul className="todo-list">{urgent.map(row)}</ul>
        </>
      )}
      {shown.length > 0 && (
        <>
          <p className="todo-group">{L("之後再做", "Later")}</p>
          <ul className="todo-list">{shown.map(row)}</ul>
        </>
      )}
      {(hidden > 0 || more) && (
        <button type="button" className="link-btn small" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? L("收起", "Show less") : L(`還有 ${hidden} 件`, `${hidden} more`)}
        </button>
      )}
      {!g.urgent.length && !calm.length && (
        <p className="muted small">{g.done.length ? L("待辦都做完了。", "All done.") : L("還沒有待辦。自己加，或由 Slack 進度回報自動加。", "No to-dos yet. Add one, or let Slack reports add them.")}</p>
      )}
      {edit && (
        <form
          className="ms-add"
          key={milestones.length} // 新增成功後清空輸入框
          action={(fd) => run(() => addMilestoneAction(projectId, String(fd.get("title") ?? ""), String(fd.get("due") ?? "")))}
        >
          <input name="title" required maxLength={80} placeholder={L("新增待辦，例如：整理說明文件", "New to-do, e.g. Tidy the docs")} />
          <input name="due" type="date" min={today} aria-label={L("期限（可以不填）", "Due date (optional)")} title={L("期限（可以不填）", "Due date (optional)")} />
          <button className="btn small" type="submit" disabled={pending}>{L("加入", "Add")}</button>
        </form>
      )}
      {g.done.length > 0 && (
        <>
          <button type="button" className="link-btn small" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? L("收起已完成", "Hide completed") : L(`已完成 ${g.done.length} 件`, `${g.done.length} completed`)}
          </button>
          {showDone && <ul className="todo-list">{g.done.map(row)}</ul>}
        </>
      )}
    </div>
  );
}
