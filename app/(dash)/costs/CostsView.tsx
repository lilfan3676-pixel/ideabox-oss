"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  budgetSummary,
  daysUntil,
  monthlyTwd,
  monthSummary,
  PURPOSE_LABEL,
  PURPOSE_LABEL_EN,
  taipeiMonth,
  toTwd,
  twd,
  type AiUsageRow,
  type Budget,
  type BudgetSummary,
  type Expense,
  type Product,
  type ProductOption,
} from "@/lib/costCalc";
import type { Fx } from "@/lib/costs";
import { addExpense, deleteExpense, saveBudget, toggleExpense, updateExpense } from "../actions";
import { ConfirmButton, SubmitButton } from "../ConfirmButton";
import { useView } from "../Nav";
import { useL, useLang } from "@/app/LangProvider";
import type { Lang } from "@/lib/i18n";
import { monthCharges, type MonthCharge } from "@/lib/insights";

const VIEWS = ["all", "subs", "once", "ai"] as const;
// 產品（專案＋ideabox＋共用）由頁面傳進來，顏色照順序
const ProductsCtx = createContext<ProductOption[]>([]);
const PALETTE = ["#7563f0", "#2b8fd6", "#3fb68b", "#e0587a", "#9b6ad6", "#2fb3b3", "#c98a2b"];
function useProducts() {
  const list = useContext(ProductsCtx);
  const lang = useLang();
  const label = (p: Product) => {
    const o = list.find((x) => x.key === p);
    return o ? (lang === "en" ? o.en : o.zh) : p;
  };
  const color = (p: Product) => {
    if (p === "shared") return "#8a8fa8";
    if (p === "ideabox") return "#f2a33a";
    const i = list.filter((x) => x.key !== "shared" && x.key !== "ideabox").findIndex((x) => x.key === p);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };
  return { keys: list.map((x) => x.key), label, color };
}

// 常用範本：金額請以實際帳單為準
const TEMPLATES = [
  { name: "Supabase Pro", nameEn: "Supabase Pro", product: "shared", amount: 25, currency: "USD", cycle: "monthly" },
  { name: "Claude 訂閱", nameEn: "Claude subscription", product: "shared", amount: 20, currency: "USD", cycle: "monthly" },
  { name: "Apple 開發者帳號", nameEn: "Apple Developer account", product: "shared", amount: 99, currency: "USD", cycle: "yearly" },
  { name: "網域", nameEn: "Domain", product: "shared", amount: 500, currency: "TWD", cycle: "yearly" },
] as const;

const purposeLabel = (lang: Lang, p: string) => (lang === "en" ? PURPOSE_LABEL_EN[p] : PURPOSE_LABEL[p]) ?? p;

function money(e: Pick<Expense, "amount" | "currency">) {
  return e.currency === "USD" ? `US$${e.amount}` : twd(e.amount);
}

export function CostsView(props: Parameters<typeof CostsInner>[0]) {
  return (
    <ProductsCtx.Provider value={props.products ?? []}>
      <CostsInner {...props} />
    </ProductsCtx.Provider>
  );
}

function CostsInner({
  expenses,
  ai,
  fx,
  today,
  msg,
  budget = null,
  budgetAiUsd = 0,
  products = [],
}: {
  products?: ProductOption[];
  expenses: Expense[];
  ai: AiUsageRow[];
  fx: Fx;
  today: string;
  msg?: string;
  budget?: Budget | null;
  budgetAiUsd?: number; // 起算日之後 AI 用量的美元總和
}) {
  const view = useView("all", VIEWS);
  const L = useL();
  const lang = useLang();
  const P = useProducts();
  const month = today.slice(0, 7);
  const s = useMemo(() => monthSummary(expenses, ai, month, fx.rate, today), [expenses, ai, month, fx.rate, today]);
  const subs = expenses.filter((e) => e.kind === "subscription");
  const once = expenses.filter((e) => e.kind === "one_time").sort((a, b) => (b.paid_on ?? "").localeCompare(a.paid_on ?? ""));
  const upcoming = subs
    .filter((e) => e.active && e.next_due && daysUntil(e.next_due, today) >= 0 && daysUntil(e.next_due, today) <= 30)
    .sort((a, b) => a.next_due!.localeCompare(b.next_due!));

  return (
    <>
      <div className="view-line d-only">
        <span className="muted small">
          {L(`${Number(month.slice(5))} 月・匯率 1 美元 ≈ ${fx.rate.toFixed(2)} 元`, `US$1 ≈ NT$${fx.rate.toFixed(2)}`)}
          {fx.fallback ? L("（暫用預設值）", " (default rate)") : fx.day ? L(`（${fx.day.slice(5).replace("-", "/")}）`, ` (${fx.day.slice(5).replace("-", "/")})`) : ""}
        </span>
      </div>
      <div className="page-title m-only">
        <h1>{L("成本", "Costs")}</h1>
        <p className="muted">
          {L(`${Number(month.slice(5))} 月・匯率 1 美元 ≈ ${fx.rate.toFixed(2)} 元`, `${new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} · US$1 ≈ NT$${fx.rate.toFixed(2)}`)}
          {fx.fallback ? L("（暫用預設值）", " (default rate)") : fx.day ? L(`（${fx.day.slice(5).replace("-", "/")}）`, ` (${fx.day.slice(5).replace("-", "/")})`) : ""}
        </p>
      </div>
      {msg && <p className="notice glass">{msg}</p>}

      {view === "all" && (
        <>
          <BudgetCard budget={budget} summary={budget ? budgetSummary(budget, expenses, budgetAiUsd, today, fx.rate) : null} />
          <section className="stats four stagger">
            <div className="glass stat">
              <b>{twd(s.total)}</b>
              <span>
                {L("本月合計", "Total this month")}
                <small className="stat-hint">
                  {s.total - s.paid >= 1
                    ? L(`已付 ${twd(s.paid)}・月底前還有 ${twd(s.total - s.paid)}`, `Paid ${twd(s.paid)} · ${twd(s.total - s.paid)} still due`)
                    : L("都已經付了", "All paid")}
                </small>
              </span>
            </div>
            <div className="glass stat">
              <b>{twd(s.subscriptions)}</b>
              <span>
                {L("本月訂閱扣款", "Subscription charges this month")}
                <small className="stat-hint">{L(`換算每月平均 ${twd(s.avgSubscriptions)}`, `Monthly average ${twd(s.avgSubscriptions)}`)}</small>
              </span>
            </div>
            <div className="glass stat">
              <b>{twd(s.oneTime)}</b>
              <span>
                {L("本月一次性", "One-time this month")}
                {s.oneTime - s.oneTimePaid >= 1 && (
                  <small className="stat-hint">{L(`其中 ${twd(s.oneTime - s.oneTimePaid)} 還沒到付款日`, `${twd(s.oneTime - s.oneTimePaid)} not due yet`)}</small>
                )}
              </span>
            </div>
            <div className="glass stat"><b>{twd(s.ai)}</b><span>{L("本月 AI 用量", "AI usage this month")}</span></div>
          </section>

          <ChargeCalendar charges={monthCharges(expenses, month, fx.rate)} month={month} today={today} />
          <div className="insight-grid">
            <section className="glass panel">
              <h3>{L("依產品", "By product")}</h3>
              {s.total > 0 ? (
                <>
                  <div className="stack-bar" role="img" aria-label={L("各產品花費比例", "Spending share by product")}>
                    {P.keys.filter((p) => (s.byProduct[p] ?? 0) > 0).map((p) => (
                      <span key={p} style={{ width: `${(s.byProduct[p] / s.total) * 100}%`, background: P.color(p) }} />
                    ))}
                  </div>
                  <ul className="donut-legend">
                    {P.keys.filter((p) => (s.byProduct[p] ?? 0) > 0 || p === "shared" || p === "ideabox").map((p) => (
                      <li key={p}>
                        <span className="swatch" style={{ background: P.color(p) }} />
                        <span className="legend-name">{P.label(p)}</span>
                        <b>{twd(s.byProduct[p] ?? 0)}</b>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted small">{L("還沒有花費紀錄。到左側「訂閱」加入你的訂閱，或到「一次性」記一筆開銷。", "No spending yet. Add your subscriptions under “Subscriptions” on the left, or log an expense under “One-time”.")}</p>
              )}
              <p className="muted small">{L("訂閱依這個月實際扣款日計算（年付只算在扣款那個月），含月底前還會扣的；AI 用量依實際 token 計算。", "Subscriptions count on their actual charge dates this month (yearly ones only in the month they renew), including charges still due; AI usage is based on actual tokens.")}</p>
            </section>

            <section className="glass panel">
              <h3>{L("30 天內扣款", "Charges in the next 30 days")}</h3>
              {upcoming.length ? (
                <ul className="due-list">
                  {upcoming.map((e) => {
                    const left = daysUntil(e.next_due!, today);
                    return (
                      <li key={e.id}>
                        <span className={`due-days ${left <= 3 ? "soon" : ""}`}>{left === 0 ? L("今天", "Today") : L(`${left} 天`, `${left} ${left === 1 ? "day" : "days"}`)}</span>
                        <span className="legend-name">{e.name}<span className="muted small">{L("・", " · ")}{P.label(e.product)}{L("・", " · ")}{e.cycle === "yearly" ? L("年付", "yearly") : L("月付", "monthly")}</span></span>
                        <b>{money(e)}</b>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted small">{L("30 天內沒有要扣款的訂閱。", "No subscription charges in the next 30 days.")}</p>
              )}
              <p className="muted small">{L("扣款前幾天起（月付 3 天、年付 7 天）每天在 Telegram 提醒一次，按訊息上的按鈕就停。", "Telegram reminds you daily from 3 days before monthly charges (7 for yearly) until you tap the button on the message.")}</p>
            </section>
          </div>
        </>
      )}

      {view === "subs" && <SubsPanel subs={subs} fx={fx} today={today} />}
      {view === "once" && <OncePanel once={once} today={today} fx={fx} />}
      {view === "ai" && <AiPanel ai={ai} fx={fx} month={month} today={today} />}
    </>
  );
}

// ---------- 總預算 ----------

function BudgetCard({ budget, summary: b }: { budget: Budget | null; summary: BudgetSummary | null }) {
  const L = useL();
  const [editing, setEditing] = useState(!budget);
  // 存好後伺服器傳回新資料 → 收起編輯框，顯示結果
  const budgetKey = JSON.stringify(budget);
  useEffect(() => {
    if (budgetKey !== "null") setEditing(false);
  }, [budgetKey]);
  if (editing || !budget || !b) {
    return (
      <section className="glass budget-card">
        <h3>{L("總預算", "Total budget")}</h3>
        <form action={saveBudget} className="budget-form">
          <label>
            {L("總預算（台幣）", "Budget (NT$)")}
            <input name="total" inputMode="numeric" defaultValue={budget?.total ?? ""} placeholder="100000" required />
          </label>
          <SubmitButton label={L("儲存", "Save")} pending={L("儲存中…", "Saving…")} className="btn primary" />
          {budget && <button type="button" className="btn ghost" onClick={() => setEditing(false)}>{L("取消", "Cancel")}</button>}
        </form>
        <p className="muted small">{L("從成本頁第一筆紀錄那天開始算：訂閱只算真的到了扣款日的那幾次，加上一次性開銷和 AI 用量。", "Counted from your first cost record: only subscription charges that actually happened, plus one-time costs and AI usage.")}</p>
      </section>
    );
  }
  const pct = Math.min(100, (b.spent / b.total) * 100);
  const over = b.remaining < 0;
  return (
    <section className={`glass budget-card ${over ? "over" : pct >= 80 ? "warn" : ""}`}>
      <div className="budget-head">
        <h3>{L("總預算", "Total budget")}</h3>
        <span className="muted small">{L(`從第一筆紀錄 ${budget.start.replaceAll("-", "/")} 起算`, `Since your first record (${budget.start})`)}</span>
        <button type="button" className="btn ghost small push" onClick={() => setEditing(true)}>{L("修改", "Edit")}</button>
      </div>
      <div className="budget-body">
      <div className="budget-gauge d-only" role="img" aria-label={L(`剩餘 ${(100 - pct).toFixed(0)}%`, `${(100 - pct).toFixed(0)}% left`)}>
        <svg viewBox="0 0 200 112" aria-hidden>
          <path className="track" d="M12 100A88 88 0 0 1 188 100" pathLength={100} />
          <path className="used" d="M12 100A88 88 0 0 1 188 100" pathLength={100} strokeDasharray={`${pct} 100`} />
        </svg>
        <div><b>{over ? "0%" : `${(100 - pct).toFixed(0)}%`}</b><span>{L("剩餘", "left")}</span></div>
      </div>
      <div className="budget-main">
      <div className="budget-nums">
        <div><span>{L("總預算", "Budget")}</span><b>{twd(b.total)}</b></div>
        <div><span>{L("總支出", "Spent")}</span><b>{twd(b.spent)}</b></div>
        <div className="budget-left"><span>{L("剩餘", "Remaining")}</span><b>{over ? `-${twd(-b.remaining)}` : twd(b.remaining)}</b></div>
      </div>
      <div className="budget-bar" role="img" aria-label={L(`已用 ${pct.toFixed(0)}%`, `${pct.toFixed(0)}% used`)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small budget-foot">
        {L(`已用 ${pct.toFixed(0)}%`, `${pct.toFixed(0)}% used`)}
        {L("・", " · ")}
        {L(`訂閱 ${twd(b.subscriptions)}、一次性 ${twd(b.oneTime)}、AI ${twd(b.ai)}`, `Subscriptions ${twd(b.subscriptions)}, one-time ${twd(b.oneTime)}, AI ${twd(b.ai)}`)}
        {b.scheduled >= 1 && L(`（另有一次性 ${twd(b.scheduled)} 還沒到付款日，到了才算）`, ` (plus ${twd(b.scheduled)} one-time not due yet, counted once paid)`)}
        {L("・", " · ")}
        {over
          ? L("已經超出預算", "Over budget")
          : b.runway === null
            ? L("目前沒有支出", "No spending yet")
            : L(`平均每月 ${twd(b.perMonth)}，照這個速度約可再撐 ${b.runway >= 120 ? "10 年以上" : `${b.runway.toFixed(1)} 個月`}`, `Avg ${twd(b.perMonth)}/month — about ${b.runway >= 120 ? "10+ years" : `${b.runway.toFixed(1)} months`} left at this pace`)}
      </p>
      </div>
      </div>
    </section>
  );
}

// ---------- 扣款月曆（電腦版）：這個月每天實際扣多少，最右邊是每週小計 ----------

function ChargeCalendar({ charges, month, today }: { charges: MonthCharge[]; month: string; today: string }) {
  const L = useL();
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 週一開始
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const dayOf = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const on = (d: number) => charges.filter((c) => c.day === dayOf(d));
  const sum = (list: MonthCharge[]) => list.reduce((s, c) => s + c.twd, 0);
  const WD: [string, string][] = [["一", "Mon"], ["二", "Tue"], ["三", "Wed"], ["四", "Thu"], ["五", "Fri"], ["六", "Sat"], ["日", "Sun"]];
  return (
    <section className="glass panel charge-cal d-only" aria-label={L("本月扣款月曆", "Charges this month")}>
      <div className="panel-head">
        <h3>{L(`${m} 月扣款月曆`, "Charges this month")}</h3>
        <span className="muted small charge-legend"><i className="paid" />{L("已付", "Paid")}<i className="due" />{L("還沒扣", "Not yet")}</span>
      </div>
      {!charges.length && <p className="muted small">{L("這個月沒有扣款。", "No charges this month.")}</p>}
      <div className="charge-grid">
        {WD.map(([zh, en]) => <span key={zh} className="charge-wd">{L(zh, en)}</span>)}
        <span className="charge-wd sum">{L("這週小計", "This week")}</span>
        {weeks.map((week, wi) => {
          const weekTotal = sum(week.flatMap((d) => (d ? on(d) : [])));
          return [
            ...week.map((d, di) => {
              const list = d ? on(d) : [];
              const due = d ? dayOf(d) > today : false;
              return (
                <div key={`${wi}-${di}`} className={`charge-day ${list.length ? (due ? "due" : "paid") : ""} ${d && dayOf(d) === today ? "today" : ""}`} title={list.map((c) => `${c.name} ${twd(c.twd)}`).join("\n") || undefined}>
                  <span className="charge-num">{d ?? ""}</span>
                  {list.length > 0 && <b>{twd(sum(list))}</b>}
                  {list.length > 0 && <span className="charge-name">{list.length > 1 ? L(`${list[0].name} 等 ${list.length} 筆`, `${list[0].name} +${list.length - 1}`) : list[0].name}</span>}
                </div>
              );
            }),
            <div key={`${wi}-sum`} className={`charge-day sum ${weekTotal ? "" : "none"}`}>
              <b>{weekTotal ? twd(weekTotal) : "—"}</b>
            </div>,
          ];
        })}
      </div>
    </section>
  );
}

// ---------- 表單 ----------

function ExpenseForm({
  kind,
  initial,
  today,
  onDone,
}: {
  kind: "subscription" | "one_time";
  initial?: Partial<Expense>;
  today: string;
  onDone?: () => void;
}) {
  const L = useL();
  const lang = useLang();
  const P = useProducts();
  const action = initial?.id ? updateExpense : addExpense;
  return (
    <form action={action} className="expense-form" onSubmit={() => onDone?.()}>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input name="name" placeholder={kind === "subscription" ? L("名稱，例如 Supabase Pro", "Name, e.g. Supabase Pro") : L("名稱，例如 比賽報名費", "Name, e.g. competition entry fee")} defaultValue={initial?.name ?? ""} required maxLength={80} />
      <select name="product" defaultValue={initial?.product ?? "shared"} aria-label={L("產品", "Product")}>
        {P.keys.map((p) => <option key={p} value={p}>{P.label(p)}</option>)}
      </select>
      <div className="money-field">
        <select name="currency" defaultValue={initial?.currency ?? "TWD"} aria-label={L("幣別", "Currency")}>
          <option value="TWD">NT$</option>
          <option value="USD">US$</option>
        </select>
        <input name="amount" placeholder={L("金額", "Amount")} inputMode="decimal" defaultValue={initial?.amount ?? ""} required />
      </div>
      {kind === "subscription" && (
        <select name="cycle" defaultValue={initial?.cycle ?? "monthly"} aria-label={L("週期", "Billing cycle")}>
          <option value="monthly">{L("每月", "Monthly")}</option>
          <option value="yearly">{L("每年", "Yearly")}</option>
        </select>
      )}
      <label className="date-field">
        <span>{kind === "subscription" ? L("下次扣款", "Next charge") : L("付款日", "Paid on")}</span>
        <input type="date" name="date" defaultValue={(kind === "subscription" ? initial?.next_due : initial?.paid_on) ?? today} required />
      </label>
      {kind === "subscription" && (
        <label className="date-field" title={L("總預算的累計支出從這天之後才算；沒填就從預算起算日開始推算", "Counts toward the budget from this date; blank = from the budget start date")}>
          <span>{L("開始訂閱（選填）", "Started (optional)")}</span>
          <input type="date" name="started" defaultValue={initial?.started_on ?? ""} max={today} />
        </label>
      )}
      <SubmitButton label={initial?.id ? L("儲存", "Save") : L("新增", "Add")} pending={L("儲存中…", "Saving…")} className="btn primary" />
    </form>
  );
}

function SubsPanel({ subs, fx, today }: { subs: Expense[]; fx: Fx; today: string }) {
  const L = useL();
  const lang = useLang();
  const P = useProducts();
  const [tpl, setTpl] = useState<Partial<Expense> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const subsKey = JSON.stringify(subs);
  useEffect(() => setEditing(null), [subsKey]);
  const totalMonthly = subs.reduce((a, e) => a + monthlyTwd(e, fx.rate), 0);
  return (
    <>
      <section className="glass panel">
        <h3>{L("新增訂閱", "Add subscription")}</h3>
        <div className="tpl-row">
          <span className="muted small">{L("常用範本", "Templates")}</span>
          {TEMPLATES.map((t) => (
            <button key={t.name} type="button" className="chip-btn" onClick={() => {
              const { nameEn, ...rest } = t;
              setTpl({ ...rest, name: lang === "en" ? nameEn : t.name } as Partial<Expense>);
            }}>
              {lang === "en" ? t.nameEn : t.name}
            </button>
          ))}
        </div>
        <ExpenseForm key={tpl?.name ?? "blank"} kind="subscription" initial={tpl ?? undefined} today={today} />
        <p className="muted small">{L("範本金額僅供參考，請以實際帳單為準。", "Template amounts are for reference only; check your actual bill.")}</p>
      </section>

      {subs.length ? (
        <ul className="expense-list stagger">
          {subs.map((e) => (
            <li key={e.id} className={`glass expense ${e.active ? "" : "inactive"}`}>
              <div className="expense-main">
                <span className="swatch" style={{ background: P.color(e.product) }} />
                <div className="expense-name">
                  <b>{e.name}</b>
                  <span className="muted small">
                    {P.label(e.product)}{L("・", " · ")}{e.cycle === "yearly" ? L("每年", "Yearly") : L("每月", "Monthly")}{L("・下次 ", " · Next ")}{e.next_due?.replaceAll("-", "/")}
                    {e.active ? "" : L("・已停用", " · Paused")}
                  </span>
                </div>
                <div className="expense-amount">
                  <b>{money(e)}</b>
                  <span className="muted small">
                    {e.currency === "USD" ? `≈ ${twd(toTwd(e.amount, "USD", fx.rate))}` : ""}
                    {e.cycle === "yearly" ? `${e.currency === "USD" ? L("・", " · ") : ""}${L("月均", "≈")} ${twd(monthlyTwd({ ...e, active: true }, fx.rate))}${L("", "/mo")}` : ""}
                  </span>
                </div>
              </div>
              <div className="holding-meta">
                <button type="button" className="link-btn" onClick={() => setEditing(editing === e.id ? null : e.id)}>
                  {editing === e.id ? L("取消", "Cancel") : L("修改", "Edit")}
                </button>
                <form action={toggleExpense}>
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="active" value={String(e.active)} />
                  <SubmitButton className="link-btn" label={e.active ? L("停用", "Pause") : L("重新啟用", "Resume")} />
                </form>
                <form action={deleteExpense} className="push">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="view" value="subs" />
                  <ConfirmButton label={L("刪除", "Delete")} message={L(`確定刪除「${e.name}」？`, `Delete “${e.name}”?`)} />
                </form>
              </div>
              {editing === e.id && <ExpenseForm kind="subscription" initial={e} today={today} />}
            </li>
          ))}
        </ul>
      ) : (
        <div className="glass empty">{L("還沒有訂閱。可以點上面的範本快速填入。", "No subscriptions yet. Click a template above to fill one in quickly.")}</div>
      )}
      {subs.length > 0 && <p className="muted small disclaimer">{L(`訂閱合計每月約 ${twd(totalMonthly)}（停用的不計入）。扣款日過了會自動往後推到下一期。`, `Subscriptions total about ${twd(totalMonthly)} per month (paused ones excluded). Past charge dates roll forward to the next period automatically.`)}</p>}
    </>
  );
}

function OncePanel({ once, today, fx }: { once: Expense[]; today: string; fx: Fx }) {
  const L = useL();
  const lang = useLang();
  const P = useProducts();
  const months = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of once) {
      const k = (e.paid_on ?? "").slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [once]);
  return (
    <>
      <section className="glass panel">
        <h3>{L("記一筆一次性開銷", "Log a one-time expense")}</h3>
        <ExpenseForm kind="one_time" today={today} />
      </section>
      {!once.length && <div className="glass empty">{L("還沒有一次性開銷，例如硬體、廣告、比賽報名費。", "No one-time expenses yet, e.g. hardware, ads, competition entry fees.")}</div>}
      {months.map(([m, list]) => (
        <section key={m} className="month-group">
          <h4 className="muted">
            {L(`${m.replace("-", " 年 ")} 月・`, `${m.replace("-", "/")} · `)}{twd(list.reduce((a, e) => a + toTwd(e.amount, e.currency, fx.rate), 0))}
          </h4>
          <ul className="expense-list">
            {list.map((e) => (
              <li key={e.id} className="glass expense">
                <div className="expense-main">
                  <span className="swatch" style={{ background: P.color(e.product) }} />
                  <div className="expense-name">
                    <b>{e.name}</b>
                    <span className="muted small">{P.label(e.product)}{L("・", " · ")}{e.paid_on?.replaceAll("-", "/")}</span>
                  </div>
                  <div className="expense-amount">
                    <b>{money(e)}</b>
                    {e.currency === "USD" && <span className="muted small">≈ {twd(toTwd(e.amount, "USD", fx.rate))}</span>}
                  </div>
                  <form action={deleteExpense}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="view" value="once" />
                    <ConfirmButton label={L("刪除", "Delete")} message={L(`確定刪除「${e.name}」？`, `Delete “${e.name}”?`)} />
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function AiPanel({ ai, fx, month, today }: { ai: AiUsageRow[]; fx: Fx; month: string; today: string }) {
  const L = useL();
  const lang = useLang();
  const thisMonth = ai.filter((a) => taipeiMonth(a.at) === month);
  const byPurpose = new Map<string, { n: number; usd: number }>();
  for (const a of thisMonth) {
    const v = byPurpose.get(a.purpose) ?? { n: 0, usd: 0 };
    byPurpose.set(a.purpose, { n: v.n + 1, usd: v.usd + a.usd });
  }
  const totalUsd = thisMonth.reduce((a, b) => a + b.usd, 0);
  // 最近 30 天每日
  const days: { day: string; usd: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    days.push({ day: d, usd: 0 });
  }
  const idx = new Map(days.map((d, i) => [d.day, i]));
  for (const a of ai) {
    const d = new Date(Date.parse(a.at) + 8 * 3600_000).toISOString().slice(0, 10);
    const i = idx.get(d);
    if (i != null) days[i].usd += a.usd;
  }
  const max = Math.max(...days.map((d) => d.usd), 0.0001);

  return (
    <>
      <section className="stats stagger">
        <div className="glass stat"><b>{twd(totalUsd * fx.rate)}</b><span>{L(`本月 AI 用量（US$${totalUsd.toFixed(2)}）`, `AI usage this month (US$${totalUsd.toFixed(2)})`)}</span></div>
        <div className="glass stat"><b>{thisMonth.length}</b><span>{L("本月呼叫次數", "API calls this month")}</span></div>
      </section>
      <div className="insight-grid">
        <section className="glass panel">
          <h3>{L("本月用途", "Usage by purpose")}</h3>
          {byPurpose.size ? (
            <ul className="donut-legend">
              {[...byPurpose.entries()].sort((a, b) => b[1].usd - a[1].usd).map(([p, v]) => (
                <li key={p}>
                  <span className="legend-name">{purposeLabel(lang, p)}<span className="muted small">{L(`・${v.n} 次`, ` · ${v.n} ${v.n === 1 ? "call" : "calls"}`)}</span></span>
                  <b>{twd(v.usd * fx.rate)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{L("本月還沒有 AI 用量紀錄（這個功能上線後才開始記錄）。", "No AI usage recorded this month (tracking started when this feature launched).")}</p>
          )}
        </section>
        <section className="glass panel">
          <h3>{L("最近 30 天", "Last 30 days")}</h3>
          <div className="day-bars" role="img" aria-label={L("最近 30 天每日 AI 花費", "Daily AI spending over the last 30 days")}>
            {days.map((d) => (
              <span key={d.day} title={`${d.day}${L("：", ": ")}${twd(d.usd * fx.rate)}`} style={{ height: `${Math.max(2, (d.usd / max) * 100)}%` }} className={d.usd ? "" : "zero"} />
            ))}
          </div>
          <div className="trend-foot small muted">
            <span>{days[0].day.slice(5).replace("-", "/")}</span>
            <span>{days[days.length - 1].day.slice(5).replace("-", "/")}</span>
          </div>
        </section>
      </div>
      <p className="muted small disclaimer">
        {L(
          "依 Claude API 官方定價估算（Haiku 每百萬 tokens 輸入 US$0.1／輸出 US$0.5，Sonnet US$2／US$10，網路搜尋每次 US$0.01）。實際金額以 Anthropic 帳單為準。",
          "Estimated from official Claude API pricing (Haiku US$0.1 input / US$0.5 output per million tokens, Sonnet US$2 / US$10, web search US$0.01 each). Your Anthropic bill is the source of truth.",
        )}
      </p>
    </>
  );
}
