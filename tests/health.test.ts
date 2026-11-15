import { describe, expect, it } from "vitest";
import {
  checkAnalysis,
  checkCost,
  checkErrors,
  checkSchedules,
  checkTelegram,
  healthMessage,
  sortIssues,
  tpeAt,
  type SysEvent,
} from "@/lib/healthLogic";

const MIN = 60_000;
const DAY = 86_400_000;
// 2026-11-02 是週一；健康檢查在台北 09:00 執行
const NOW = tpeAt("2026-11-02", 9);
const iso = (ms: number) => new Date(ms).toISOString();
const run = (source: string, ms: number, ok = true, detail: string | null = null): SysEvent => ({ at: iso(ms), kind: "run", source, ok, detail });

/** 完整健康的一週：監控每 5 分鐘、每天 21:05 每日排程、週日週報 */
function healthyWeek(skip: (e: SysEvent) => boolean = () => false): SysEvent[] {
  const ev: SysEvent[] = [];
  for (let t = NOW - 7 * DAY; t <= NOW; t += 5 * MIN) ev.push(run("monitor", t));
  for (const d of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]) ev.push(run("daily", tpeAt(d, 21, 5)));
  ev.push(run("weekly_digest", tpeAt("2026-11-01", 21, 6)));
  return ev.filter((e) => !skip(e));
}

describe("排程檢查", () => {
  it("一切正常時沒有問題", () => {
    expect(checkSchedules(healthyWeek(), NOW, NOW - 30 * DAY)).toEqual([]);
  });

  it("紀錄不到 6 小時先不判斷（剛執行 migration）", () => {
    expect(checkSchedules([], NOW, NOW - 2 * 3600_000)).toEqual([]);
  });

  it("剛開始記錄 2 天：只檢查這 2 天，不會把之前的日子當漏跑", () => {
    const since = NOW - 2 * DAY;
    const ev = healthyWeek().filter((e) => +new Date(e.at) >= since);
    expect(checkSchedules(ev, NOW, since)).toEqual([]);
  });

  it("監控停了超過 20 分鐘 → 嚴重", () => {
    const ev = healthyWeek((e) => e.source === "monitor" && +new Date(e.at) > NOW - 3 * 3600_000);
    const r = checkSchedules(ev, NOW, NOW - 30 * DAY);
    expect(r[0].level).toBe("error");
    expect(r[0].zh).toContain("3 小時");
  });

  it("監控漏跑三成 → 提醒", () => {
    let n = 0;
    const ev = healthyWeek((e) => e.source === "monitor" && +new Date(e.at) < NOW - DAY && n++ % 3 === 0);
    const r = checkSchedules(ev, NOW, NOW - 30 * DAY);
    expect(r.map((i) => i.zh).join()).toContain("產品監控漏跑");
  });

  it("每日排程漏跑、部分失敗、週報沒送出", () => {
    const ev = healthyWeek((e) => (e.source === "daily" && e.at === iso(tpeAt("2026-10-27", 21, 5))) || e.source === "weekly_digest");
    ev.push(run("daily", tpeAt("2026-10-29", 21, 40), false, "radar: timeout"));
    const r = checkSchedules(ev.filter((e) => !(e.source === "daily" && e.at === iso(tpeAt("2026-10-29", 21, 5)))), NOW, NOW - 30 * DAY);
    const text = r.map((i) => i.zh).join("|");
    expect(text).toContain("每日排程沒有執行：10/27");
    expect(text).toContain("10/29 每日排程有部分工作失敗：radar: timeout");
    expect(text).toContain("11/1 的週報沒有成功送出");
  });

  it("每日排程延遲到 21:50 仍算有跑", () => {
    const ev = healthyWeek((e) => e.source === "daily").concat(
      ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"].map((d) => run("daily", tpeAt(d, 21, 50))),
    );
    expect(checkSchedules(ev, NOW, NOW - 30 * DAY)).toEqual([]);
  });
});

describe("分析檢查", () => {
  it("放棄重試、卡住", () => {
    expect(checkAnalysis({ gaveUp: 2, stuck: 1 })).toHaveLength(2);
    expect(checkAnalysis({ gaveUp: 0, stuck: 0 })).toEqual([]);
  });
});

describe("AI 費用", () => {
  const top = { zh: "補助雷達", en: "Grant radar", usd: 1.2 };
  it("比平常高 50% 且多 0.5 美元以上才提醒", () => {
    expect(checkCost({ weekUsd: 2, baselineUsd: 1, topPurpose: top })[0].zh).toContain("高 100%");
    expect(checkCost({ weekUsd: 0.4, baselineUsd: 0.1, topPurpose: top })).toEqual([]); // 只多 0.3 美元
    expect(checkCost({ weekUsd: 1.4, baselineUsd: 1, topPurpose: top })).toEqual([]);
  });
  it("沒有比較基準時超過 5 美元才提醒", () => {
    expect(checkCost({ weekUsd: 3, baselineUsd: null, topPurpose: top })).toEqual([]);
    expect(checkCost({ weekUsd: 6, baselineUsd: null, topPurpose: top })).toHaveLength(1);
  });
});

describe("Telegram 與網站錯誤", () => {
  it("Webhook 狀態", () => {
    expect(checkTelegram(null, NOW)[0].level).toBe("warn");
    expect(checkTelegram({ url: "", pending_update_count: 0 }, NOW)[0].level).toBe("error");
    expect(checkTelegram({ url: "https://x", pending_update_count: 0 }, NOW)).toEqual([]);
    expect(checkTelegram({ url: "https://x", pending_update_count: 0, last_error_date: (NOW - DAY) / 1000, last_error_message: "Bad Gateway" }, NOW)[0].zh).toContain("Bad Gateway");
    expect(checkTelegram({ url: "https://x", pending_update_count: 0, last_error_date: (NOW - 9 * DAY) / 1000 }, NOW)).toEqual([]);
    expect(checkTelegram({ url: "https://x", pending_update_count: 8 }, NOW)).toHaveLength(1);
  });
  it("錯誤依來源統計", () => {
    const err = (source: string, m: number, detail: string): SysEvent => ({ at: iso(NOW - m * MIN), kind: "error", source, ok: false, detail });
    const r = checkErrors([err("idea_analysis", 50, "a"), err("idea_analysis", 40, "b"), err("telegram", 10, "最新")]);
    expect(r[0].zh).toBe("網站這週記錄到 3 次錯誤：點子分析 2、Telegram 機器人 1。最近一次：最新");
    expect(checkErrors([run("monitor", NOW)])).toEqual([]);
  });
  it("排序與訊息", () => {
    const list = sortIssues([...checkCost({ weekUsd: 9, baselineUsd: null, topPurpose: null }), ...checkTelegram({ url: "", pending_update_count: 0 }, NOW)]);
    expect(list[0].level).toBe("error");
    const msg = healthMessage(list, "https://app.example/", (s) => s);
    expect(msg).toContain("發現 2 個問題");
    expect(msg).toContain("https://app.example/monitor");
  });
});
