// 健康檢查實際讀資料庫：一週的紀錄超過 1000 筆（Supabase 一次最多回 1000 筆）也要全部讀到
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_WEBHOOK_SECRET = "s3cret";
process.env.TELEGRAM_OWNER_ID = "111";

const MIN = 60_000;
const DAY = 86_400_000;

beforeEach(() => {
  reset();
  vi.stubGlobal("fetch", async () => Response.json({ ok: true, result: { url: "https://x/api/telegram", pending_update_count: 0 } }));
});

describe("健康檢查讀取紀錄", () => {
  it("監控＋Slack 每 5 分鐘各記一筆（一週約 4000 筆），最新的也讀得到，不會誤報排程停了", async () => {
    const now = Date.now();
    for (let t = now - 7 * DAY; t <= now; t += 5 * MIN) {
      tables.sys_events.push({ at: new Date(t).toISOString(), kind: "run", source: "monitor", ok: true, detail: null });
      tables.sys_events.push({ at: new Date(t + 1000).toISOString(), kind: "run", source: "slack", ok: true, detail: null });
    }
    // 比一週還舊的第一筆，代表紀錄已經存在很久
    tables.sys_events.unshift({ at: new Date(now - 30 * DAY).toISOString(), kind: "run", source: "monitor", ok: true, detail: null });
    expect(tables.sys_events.length).toBeGreaterThan(4000);

    const { runHealthCheck } = await import("@/lib/health");
    const r = await runHealthCheck({ notify: false });
    expect(r.stats.runs.monitor).toBeGreaterThan(2000);
    expect(JSON.stringify(r.issues)).not.toContain("產品監控已經");
  });
});
