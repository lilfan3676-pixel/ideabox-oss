// 每晚進度確認：21:30 用 Telegram 問「有日期、到期還沒打勾」的待辦，按鈕直接更新（下一步不問了）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import type { Milestone, Project } from "@/lib/projectLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => void fn() };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const CAFE_ID = "22222222-2222-2222-2222-222222222222";
const M1 = "33333333-3333-3333-3333-333333333333";
const M2 = "44444444-4444-4444-4444-444444444444";
const proj = (over: Partial<Project> = {}): Project => ({
  id: FIT_ID, slug: "fit", name: "Fit", stages: ["構想", "開發"], stage: 1, next_step: "整理回報", status: "active", folder: null, repo: null, sort: 10,
  last_activity_at: "2026-11-01T00:00:00.000Z", stale_asked_at: null, ...over,
});
const ms = (over: Partial<Milestone> = {}): Milestone => ({ id: M1, project_id: FIT_ID, title: "正式上架", due: "2026-11-20", done: false, reminded_7: true, reminded_1: true, ...over });

// 台北 2026-11-20 21:35
const NIGHT = Date.parse("2026-11-20T13:35:00Z");
const cb = (data: string) => ({ id: "c1", data, message: { message_id: 9, chat: { id: 111 } }, from: { id: 111 } }) as never;

let sent: Array<{ method: string; body: any }> = [];
let tgOk = true;

beforeEach(() => {
  reset();
  sent = [];
  tgOk = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) {
      sent.push({ method: u.split("/").pop()!, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return tgOk ? Response.json({ ok: true, result: { message_id: sent.length } }) : Response.json({ ok: false }, { status: 500 });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
});

describe("每晚進度確認", () => {
  it("要問哪些：只問進行中專案裡有日期、到期或過期沒打勾的待辦；沒日期的待辦和下一步都不問", async () => {
    const { planCheckin, taipeiMinutes, addDays } = await import("@/lib/checkin");
    const asks = planCheckin(
      [proj(), proj({ id: CAFE_ID, slug: "cafe", name: "Cafe", status: "paused", next_step: "找店面" }), proj({ id: "p3", slug: "x", name: "X", next_step: " " })],
      [ms(), ms({ id: M2, title: "送審", due: "2026-11-17" }), ms({ id: "m3", title: "還沒到", due: "2026-11-21" }), ms({ id: "m4", done: true }), ms({ id: "m5", project_id: CAFE_ID }), ms({ id: "m6", title: "沒期限", due: null })],
      "2026-11-20",
    );
    expect(asks.map((a) => (a.kind === "milestone" ? `${a.milestone.title}:${a.late}` : `step:${a.step}`))).toEqual(["送審:3", "正式上架:0"]);
    expect(taipeiMinutes(NIGHT)).toBe(21 * 60 + 35);
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
  });

  it("21:30 之後才問、一天只問一次、沒有要問的不傳", async () => {
    const { runCheckin } = await import("@/lib/checkin");
    tables.projects.push({ ...proj() });
    tables.project_milestones.push({ ...ms() }, { ...ms({ id: M2, title: "還沒到", due: "2026-11-25" }) });
    expect(await runCheckin(NIGHT - 10 * 60_000)).toBe(0); // 21:25
    expect(sent).toHaveLength(0);
    expect(await runCheckin(NIGHT)).toBe(1);
    expect(sent[0].body.text).toContain("正式上架（今天到期）");
    expect(sent[0].body.text).toContain("待辦");
    expect(sent[0].body.reply_markup.inline_keyboard.flat().map((b: { text: string }) => b.text)).toEqual(["✅ 做了", "⏰ 延 3 天", "⏰ 延 1 週", "先不動"]);
    expect(sent.flatMap((s) => s.body.reply_markup.inline_keyboard.flat()).every((b: { callback_data: string }) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
    expect(await runCheckin(NIGHT + 5 * 60_000)).toBe(0);
    expect(sent).toHaveLength(1);
    // 隔天：過期 1 天，再問一次
    expect(await runCheckin(NIGHT + 86_400_000)).toBe(1);
    expect(sent[1].body.text).toContain("11/20 到期，過了 1 天");

    reset();
    sent = [];
    // 只有下一步、沒有到期的待辦：不傳
    tables.projects.push({ ...proj() });
    expect(await runCheckin(NIGHT)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("Telegram 傳不出去：不算問過，下一輪再試", async () => {
    const { runCheckin } = await import("@/lib/checkin");
    tables.projects.push({ ...proj() });
    tables.project_milestones.push({ ...ms() });
    tgOk = false;
    expect(await runCheckin(NIGHT)).toBe(0);
    tgOk = true;
    expect(await runCheckin(NIGHT + 5 * 60_000)).toBe(1);
  });

  it("里程碑按鈕：做了就打勾並記日誌；延期改日期並重設提醒；先不動什麼都不改", async () => {
    const { handleCallback } = await import("@/lib/tgFlow");
    const { handleCheckinButton } = await import("@/lib/checkin");
    tables.projects.push({ ...proj() });
    tables.project_milestones.push({ ...ms() }, { ...ms({ id: M2, title: "送審", due: "2026-11-17" }) });

    await handleCallback(cb(`ck:m:x:${M1}`));
    expect(tables.project_milestones[0]).toMatchObject({ done: false, due: "2026-11-20" });
    expect(sent.map((s) => s.method)).toEqual(["answerCallbackQuery", "editMessageReplyMarkup"]);

    await handleCallback(cb(`ck:m:d:${M1}`));
    expect(tables.project_milestones[0].done).toBe(true);
    expect(tables.project_logs.at(-1)).toMatchObject({ project_id: FIT_ID, text: "完成待辦：正式上架", source: "telegram" });
    expect(sent.at(-1)!.body.text).toContain("已打勾：正式上架");
    expect(tables.projects[0].last_activity_at).not.toBe("2026-11-01T00:00:00.000Z");
    await handleCallback(cb(`ck:m:d:${M1}`));
    expect(sent.filter((s) => s.method === "answerCallbackQuery").at(-1)!.body.text).toContain("已經打勾");

    // 延期從「今天」算，不是從原本的到期日
    const r = await handleCheckinButton(`ck:m:7:${M2}`, NIGHT);
    expect(r.text).toContain("延到 11/27");
    expect(tables.project_milestones[1]).toMatchObject({ due: "2026-11-27", done: false, reminded_7: false, reminded_1: false });
    expect(tables.project_logs.at(-1)!.text).toBe("待辦延期：送審（11/17 → 11/27）");
    expect((await handleCheckinButton(`ck:m:3:${M2}`, NIGHT)).text).toContain("延到 11/23");

    expect((await handleCheckinButton("ck:m:d:00000000-0000-0000-0000-000000000000")).toast).toContain("已經不在");
  });

  it("下一步按鈕：做完記日誌並清掉下一步；下一步換過了就不動", async () => {
    const { handleCheckinButton, stepKey } = await import("@/lib/checkin");
    tables.projects.push({ ...proj() });
    const key = stepKey("整理回報");

    expect((await handleCheckinButton(`ck:n:x:${FIT_ID}:${key}`)).done).toBe(true);
    expect(tables.projects[0].next_step).toBe("整理回報");

    tables.projects[0].next_step = "換成別的事";
    expect((await handleCheckinButton(`ck:n:d:${FIT_ID}:${key}`)).toast).toContain("已經換過了");
    expect(tables.project_logs).toHaveLength(0);

    tables.projects[0].next_step = "整理回報";
    const r = await handleCheckinButton(`ck:n:d:${FIT_ID}:${key}`);
    expect(r.text).toContain("fit 下一步");
    expect(tables.projects[0].next_step).toBeNull();
    expect(tables.project_logs.at(-1)).toMatchObject({ text: "完成：整理回報", source: "telegram" });
    expect((await handleCheckinButton(`ck:n:d:${FIT_ID}:${key}`)).toast).toContain("已經換過了");
  });
});
