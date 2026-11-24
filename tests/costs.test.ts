import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetSummary, chargesBetween, firstRecordDay, monthSummary, pastCharges, rollDue, shouldRemind, usdCost, type Expense } from "@/lib/costCalc";
import { fakeDb, reset, tables } from "./support/fakeDb";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});

const E = (o: Partial<Expense>): Expense => ({
  id: "e" + Math.random(), name: "x", product: "shared", kind: "subscription", amount: 100, currency: "TWD",
  cycle: "monthly", next_due: "2026-11-01", paid_on: null, note: null, active: true, reminded_for: null, created_at: "", ...o,
});

describe("成本計算", () => {
  it("扣款日往後推：月底日期不會越推越早", () => {
    expect(rollDue("2026-01-31", "monthly", "2026-02-15")).toBe("2026-02-28");
    expect(rollDue("2026-01-31", "monthly", "2026-03-01")).toBe("2026-03-31");
    expect(rollDue("2025-11-05", "yearly", "2026-10-31")).toBe("2026-11-05");
    expect(rollDue("2026-12-01", "monthly", "2026-10-31")).toBe("2026-12-01"); // 未來的不動
  });
  it("續約提醒：年付前 7 天、月付前 1 天、只提醒一次、停用不提醒", () => {
    expect(shouldRemind(E({ cycle: "yearly", next_due: "2026-11-07" }), "2026-10-31")).toBe(true);
    expect(shouldRemind(E({ cycle: "yearly", next_due: "2026-11-08" }), "2026-10-31")).toBe(false);
    expect(shouldRemind(E({ next_due: "2026-11-01" }), "2026-10-31")).toBe(true);
    expect(shouldRemind(E({ next_due: "2026-11-03" }), "2026-10-31")).toBe(true); // 月付前 3 天起
    expect(shouldRemind(E({ next_due: "2026-11-04" }), "2026-10-31")).toBe(false);
    expect(shouldRemind(E({ next_due: "2026-11-01" }), "2026-10-31", "2026-10-31")).toBe(false); // 今天提醒過了
    expect(shouldRemind(E({ next_due: "2026-11-01" }), "2026-10-31", "2026-10-30")).toBe(true); // 昨天提醒過，今天再提醒
    expect(shouldRemind(E({ next_due: "2026-11-01", reminded_for: "2026-11-01" }), "2026-10-31")).toBe(false);
    expect(shouldRemind(E({ next_due: "2026-11-01", active: false }), "2026-10-31")).toBe(false);
  });
  it("AI 費用：Haiku、Sonnet、網路搜尋、未知模型用 Sonnet 價", () => {
    expect(usdCost("claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(usdCost("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 1000, server_tool_use: { web_search_requests: 3 } })).toBeCloseTo(0.002 + 0.01 + 0.03);
    expect(usdCost("mystery", { input_tokens: 1_000_000 })).toBeCloseTo(2);
    expect(usdCost("x", undefined)).toBe(0);
  });
  it("本月合計：依實際扣款日（年付只算扣款那個月）、美金換算、一次性只算本月、AI 依台北時間月份", () => {
    const s = monthSummary(
      [
        E({ product: "myapp", amount: 25, currency: "USD", next_due: "2026-11-05" }), // 10/5 扣
        E({ product: "myapp", amount: 99, currency: "USD", cycle: "yearly", next_due: "2027-03-01" }), // 這個月不扣
        E({ product: "ideabox", amount: 300, next_due: "2026-10-20" }), // 10/20 還沒到
        E({ product: "site", amount: 300, active: false, next_due: "2026-10-10" }), // 停用：10/10 那次不扣
        E({ kind: "one_time", cycle: null, next_due: null, paid_on: "2026-10-05", amount: 1000, product: "ideabox" }),
        E({ kind: "one_time", cycle: null, next_due: null, paid_on: "2026-10-27", amount: 5000 }), // 還沒到
        E({ kind: "one_time", cycle: null, next_due: null, paid_on: "2026-09-30", amount: 999 }),
      ],
      [
        { at: "2026-10-31T16:30:00Z", model: "h", purpose: "x", product: "ideabox", usd: 1 }, // 台北 11/1，不算
        { at: "2026-10-10T00:00:00Z", model: "h", purpose: "idea_analysis", product: "myapp", usd: 0.5 },
      ],
      "2026-10",
      32,
      "2026-10-11",
    );
    expect(s.subscriptions).toBe(800 + 300);
    expect(s.subscriptionsPaid).toBe(800);
    expect(s.avgSubscriptions).toBeCloseTo(800 + (99 * 32) / 12 + 300);
    expect(s.oneTime).toBe(6000);
    expect(s.oneTimePaid).toBe(1000);
    expect(s.ai).toBe(16);
    expect(s.total).toBe(1100 + 6000 + 16);
    expect(s.paid).toBe(800 + 1000 + 16);
    expect(s.byProduct.myapp).toBe(800 + 16);
    expect(s.byProduct.site ?? 0).toBe(0);
  });
  it("本月已付的部分跟總預算算法一致（同一個月起算時兩邊一樣）", () => {
    const list = [
      E({ amount: 3200, next_due: "2026-11-15", started_on: "2026-10-13" }),
      E({ amount: 999, cycle: "yearly", next_due: "2027-10-13", started_on: "2026-10-13" }),
      E({ kind: "one_time", cycle: null, next_due: null, paid_on: "2026-10-29", amount: 500 }),
      E({ kind: "one_time", cycle: null, next_due: null, paid_on: "2026-10-30", amount: 5000 }),
    ];
    const m = monthSummary(list, [], "2026-10", 32, "2026-10-29");
    const b = budgetSummary({ total: 100000, start: "2026-10-01" }, list, 0, "2026-10-29", 32);
    expect(m.paid).toBe(b.spent);
    expect(b.scheduled).toBe(5000);
    expect(m.total - m.paid).toBe(5000);
  });
  it("chargesBetween：往前往後都推、尊重開始日與停用", () => {
    const sub = (o: Partial<Expense>) => E({ next_due: "2026-11-15", ...o });
    expect(chargesBetween(sub({}), "2026-11-01", "2026-12-31")).toEqual(["2026-11-15", "2026-12-15"]);
    expect(chargesBetween(sub({ next_due: "2026-10-15" }), "2026-11-01", "2026-11-31")).toEqual(["2026-11-15"]); // 還沒往後推的
    expect(chargesBetween(sub({ started_on: "2026-11-20" }), "2026-11-01", "2026-12-31")).toEqual(["2026-11-20", "2026-12-15"]); // 開始那天付第一筆
    expect(chargesBetween(sub({ started_on: "2026-11-05" }), "2026-11-01", "2026-12-31")).toEqual(["2026-11-15", "2026-12-15"]); // 離 15 號太近：第一筆就是 15 號
    expect(chargesBetween(sub({ active: false }), "2026-10-01", "2026-12-31")).toEqual(["2026-10-15"]);
  });
  it("開始訂閱那天就算一筆（使用者的 Claude：11/11 訂、下次扣款 12/10）", () => {
    const claude = E({ amount: 100, currency: "USD", next_due: "2026-12-10", started_on: "2026-11-11" });
    expect(pastCharges(claude, "2026-10-13", "2026-11-11")).toEqual(["2026-11-11"]);
    expect(chargesBetween(claude, "2026-11-01", "2026-11-31")).toEqual(["2026-11-11"]);
    expect(chargesBetween(claude, "2026-12-01", "2026-12-31")).toEqual(["2026-12-10"]);
    expect(budgetSummary({ total: 100000, start: "2026-10-13" }, [claude], 0, "2026-11-11", 32).subscriptions).toBe(3200);
    expect(monthSummary([claude], [], "2026-11", 32, "2026-11-11").subscriptionsPaid).toBe(3200);
    // 開始日剛好是週期日：不重複
    expect(pastCharges(E({ next_due: "2026-12-13", started_on: "2026-10-13" }), "2026-10-13", "2026-11-20")).toEqual(["2026-10-13", "2026-11-13"]);
    // 開始日在起算日之前：不算
    expect(pastCharges(E({ next_due: "2026-12-10", started_on: "2026-09-01" }), "2026-10-13", "2026-11-20")).toEqual(["2026-11-10"]);
  });
});

describe("每日成本工作", () => {
  let sent: string[] = [];
  beforeEach(() => {
    reset();
    sent = [];
    Object.assign(process.env, { TELEGRAM_BOT_TOKEN: "IDEABOX", TELEGRAM_OWNER_ID: "111" });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://open.er-api.com/")) return Response.json({ result: "success", rates: { TWD: 32.4 } });
      if (u === "https://api.telegram.org/botIDEABOX/sendMessage") {
        sent.push(JSON.parse(String(init?.body)).text);
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      throw new Error("unexpected " + u);
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T13:00:00Z")); // 台北 10/31 21:00
  });

  it("推扣款日、一天提醒一次、隔天再提醒、按了知道了就停、存匯率", async () => {
    tables.expenses.push(
      E({ id: "a", name: "Supabase Pro", amount: 25, currency: "USD", next_due: "2026-10-01" }), // 已過 → 11/01，明天扣款
      E({ id: "b", name: "Apple", cycle: "yearly", amount: 99, currency: "USD", next_due: "2026-12-20" }),
    );
    const { runCostDaily } = await import("@/lib/costs");
    const r = await runCostDaily();
    expect(r).toMatchObject({ fx: 32.4, rolled: 1, reminded: 1 });
    expect(tables.expenses.find((e) => e.id === "a")).toMatchObject({ next_due: "2026-11-01", reminded_for: null });
    expect(sent[0]).toContain("Supabase Pro");
    expect(sent[0]).toContain("明天扣款");
    expect(JSON.parse(tables.settings.find((s) => s.key === "fx_usd_twd")!.value).rate).toBe(32.4);
    await runCostDaily();
    expect(sent).toHaveLength(1); // 同一天不重複
    vi.setSystemTime(new Date("2026-11-01T13:00:00Z")); // 隔天（扣款當天）
    await runCostDaily();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("今天扣款");
    // 按「知道了」：這期不再提醒
    const { handleCostButton } = await import("@/lib/costs");
    expect((await handleCostButton("cx:k:" + tables.expenses.find((e) => e.name === "Supabase Pro")!.id)).done).toBe(true);
    vi.setSystemTime(new Date("2026-11-01T15:00:00Z"));
    tables.settings.splice(0, tables.settings.length, ...tables.settings.filter((s) => s.key !== "cost_reminded")); // 就算沒有「今天提醒過」的紀錄也不該再傳
    await runCostDaily();
    expect(sent).toHaveLength(2);
    // 按「已經取消訂閱」：標成停用
    const b = tables.expenses.find((e) => e.name === "Apple")!;
    await handleCostButton("cx:c:" + b.id);
    expect(b.active).toBe(false);
    expect((await handleCostButton("cx:k:亂寫")).done).toBe(false);
    vi.useRealTimers();
  });
});

describe("總預算", () => {
  const sub = (over: Partial<Expense>): Expense => ({
    id: "s", name: "x", product: "shared", kind: "subscription", amount: 100, currency: "TWD", cycle: "monthly",
    next_due: "2026-11-15", paid_on: null, note: null, active: true, reminded_for: null, created_at: "2026-01-01T00:00:00Z", ...over,
  });
  it("訂閱往回推算扣過的日子：只算起算日（或開始訂閱日）之後、今天以前", () => {
    expect(pastCharges(sub({}), "2026-08-01", "2026-11-02")).toEqual(["2026-08-15", "2026-09-15", "2026-10-15"]);
    expect(pastCharges(sub({ started_on: "2026-10-01" }), "2026-08-01", "2026-11-02")).toEqual(["2026-10-15"]);
    expect(pastCharges(sub({ next_due: "2026-11-02" }), "2026-10-20", "2026-11-02")).toEqual(["2026-11-02"]);
    expect(pastCharges(sub({ cycle: "yearly", next_due: "2027-03-01" }), "2025-01-01", "2026-11-02")).toEqual(["2025-03-01", "2026-03-01"]);
    expect(pastCharges(sub({ next_due: "2026-12-31" }), "2026-08-01", "2026-11-02")).toEqual(["2026-08-31", "2026-09-30", "2026-10-31"]);
    // 停用的：下次扣款日那次沒有真的扣
    expect(pastCharges(sub({ active: false, next_due: "2026-10-15" }), "2026-08-01", "2026-11-02")).toEqual(["2026-08-15", "2026-09-15"]);
  });
  it("起算日 = 第一次真的付錢那天（付款日、開始訂閱日最早的；未來的不算）；都沒有才用加入日", () => {
    const once = (paid: string) => ({ ...sub({ kind: "one_time", created_at: "2026-10-30T00:00:00Z" }), paid_on: paid });
    // 跟使用者的帳本一樣：Apple 10/13 開始、Supabase 10/17 開始、icon 10/29 付款；加進 ideabox 都是 10/30
    expect(firstRecordDay([sub({ started_on: "2026-10-13", created_at: "2026-10-30T00:00:00Z" }), sub({ started_on: "2026-10-17" }), once("2026-10-29"), once("2026-11-27")], "2026-11-02")).toBe("2026-10-13");
    expect(firstRecordDay([once("2026-11-27"), sub({ created_at: "2026-10-19T17:00:00Z" })], "2026-11-02")).toBe("2026-10-20"); // 只有未來的付款日 → 用加入日（台北時間）
    expect(firstRecordDay([], "2026-11-02")).toBe("2026-11-02");
  });
  it("累計支出 = 訂閱推算＋起算日後的一次性＋AI；剩餘與還能撐幾個月", () => {
    const b = budgetSummary(
      { total: 100000, start: "2026-08-03" },
      [
        sub({ amount: 3200 }), // 8/15、9/15、10/15 → 9600
        sub({ id: "u", amount: 25, currency: "USD", next_due: "2026-11-17", started_on: "2026-10-01" }), // 10/17 → 25*32 = 800
        { ...sub({ id: "o", kind: "one_time", cycle: null, next_due: null, amount: 5000 }), paid_on: "2026-10-05" },
        { ...sub({ id: "p", kind: "one_time", cycle: null, next_due: null, amount: 9999 }), paid_on: "2026-07-01" }, // 起算前，不算
      ],
      10, // AI 10 美元 → 320
      "2026-11-02",
      32,
    );
    expect(b.subscriptions).toBe(10400);
    expect(b.oneTime).toBe(5000);
    expect(b.ai).toBe(320);
    expect(b.spent).toBe(15720);
    expect(b.remaining).toBe(84280);
    expect(b.runway).toBeGreaterThan(15);
    expect(budgetSummary({ total: 1000, start: "2026-11-01" }, [], 0, "2026-11-02", 32).runway).toBeNull();
  });
});
