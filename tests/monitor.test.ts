import { describe, expect, it } from "vitest";
import { durationText, formatBytes, nextStatus, type StatusRow } from "@/lib/monitorLogic";

const T0 = "2026-10-30T10:00:00.000Z";
const t = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const ok = { ok: true, latencyMs: 120 };
const bad = { ok: false, latencyMs: 10_000, error: "逾時" };

function run(seq: boolean[]) {
  let row: StatusRow | null = null;
  const events: (string | null)[] = [];
  seq.forEach((good, i) => {
    const r = nextStatus(row, "fit_api", "fit", good ? ok : bad, t(i * 5));
    row = r.row;
    events.push(r.event);
  });
  return { row: row!, events };
}

describe("nextStatus", () => {
  it("一次失敗不通知、不算異常", () => {
    const { row, events } = run([true, false, true]);
    expect(events).toEqual([null, null, null]);
    expect(row.ok).toBe(true);
    expect(row.fail_count).toBe(0);
  });
  it("連續兩次失敗通知一次掛掉，持續失敗不重複通知", () => {
    const { row, events } = run([true, false, false, false, false]);
    expect(events).toEqual([null, null, "down", null, null]);
    expect(row.ok).toBe(false);
    expect(row.notified_down).toBe(true);
    expect(row.last_error).toBe("逾時");
  });
  it("恢復時通知一次，並回報中斷時間", () => {
    let row: StatusRow | null = null;
    for (const [i, g] of [true, false, false, false].entries()) row = nextStatus(row, "fit_api", "fit", g ? ok : bad, t(i * 5)).row;
    const r = nextStatus(row, "fit_api", "fit", ok, t(20));
    expect(r.event).toBe("up");
    expect(r.downSince).toBe(t(10));
    expect(r.row.ok).toBe(true);
    expect(r.row.notified_down).toBe(false);
    expect(nextStatus(r.row, "fit_api", "fit", ok, t(25)).event).toBe(null);
  });
  it("第一次檢查就失敗也要兩次才通知", () => {
    expect(run([false]).events).toEqual([null]);
    expect(run([false, false]).events).toEqual([null, "down"]);
  });
});

describe("格式化", () => {
  it("durationText", () => {
    expect(durationText(30_000)).toBe("1 分鐘");
    expect(durationText(12 * 60_000)).toBe("12 分鐘");
    expect(durationText(125 * 60_000)).toBe("2 小時 5 分");
    expect(durationText(26 * 3600_000)).toBe("1 天 2 小時");
  });
  it("formatBytes", () => {
    expect(formatBytes(23 * 1024 ** 2)).toBe("23.0 MB");
    expect(formatBytes(8 * 1024 ** 3)).toBe("8.00 GB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("專案短名對應產品", () => {
  it("用產品的 key 或 slugs 對應；沒有回 null", async () => {
    const { productForSlug } = await import("@/lib/monitorLogic");
    const products = [{ key: "notes", slugs: ["notes", "oldnotes"] }, { key: "site-a1", slugs: ["blog"] }];
    expect(productForSlug("oldnotes", products)).toBe("notes");
    expect(productForSlug("blog", products)).toBe("site-a1");
    expect(productForSlug("youth-fund", products)).toBeNull();
  });
});

describe("網址整理", () => {
  it("補 https、去掉結尾斜線、擋掉不是網址的", async () => {
    const { cleanSiteUrl } = await import("@/lib/monitorLogic");
    expect(cleanSiteUrl("example.com/")).toBe("https://example.com");
    expect(cleanSiteUrl(" http://a.b.co/x/ ")).toBe("http://a.b.co/x");
    expect(cleanSiteUrl("javascript:alert(1)")).toBeNull();
    expect(cleanSiteUrl("hello")).toBeNull();
    expect(cleanSiteUrl("")).toBeNull();
  });
});
