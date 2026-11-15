import { describe, expect, it } from "vitest";
import { daysBetween, isIsoDate, reminderFor, taipeiDate, taipeiWeekday } from "@/lib/dates";
import { grantKey } from "@/lib/grantKey";
import { clampScore, cleanList, cleanTags, cleanText, isJunkText, normalizeCategory, totalScore } from "@/lib/scoring";
import { buildBrief } from "@/lib/brief";
import { extractUrls, getMeta, htmlToText, isUsefulText, parseLink, parseOpenGraph, stripUrls } from "@/lib/threads";

describe("Threads 連結", () => {
  it("從 iPhone 分享文字抓出連結並去掉結尾標點", () => {
    const t = "超適合 Fit！https://www.threads.com/@abc.def/post/DABC123xyz?xmt=AQG。 再看這個 https://threads.net/@x_y/post/C9_-k";
    expect(extractUrls(t)).toEqual([
      "https://www.threads.com/@abc.def/post/DABC123xyz?xmt=AQG",
      "https://threads.net/@x_y/post/C9_-k",
    ]);
    expect(stripUrls(t)).toBe("超適合 Fit！ 再看這個");
  });

  it("threads.net 與 threads.com、有無參數都視為同一則", () => {
    const a = parseLink("https://www.threads.net/@abc/post/XYZ?xmt=1&slof=1")!;
    const b = parseLink("https://threads.com/@abc/post/XYZ/")!;
    expect(a.key).toBe(b.key);
    expect(a.canonical).toBe("https://www.threads.com/@abc/post/XYZ");
    expect(a.isPost).toBe(true);
    expect(a.author).toBe("@abc");
  });

  it("其他網站連結也能存，不合法的網址回傳 null", () => {
    expect(parseLink("https://example.com/a/?q=1")!.isThreads).toBe(false);
    expect(parseLink("not a url")).toBeNull();
    expect(parseLink("ftp://x.com")).toBeNull();
  });

  it("entities 給的網址也會合併且去重", () => {
    expect(extractUrls("看這個 https://a.com/x", ["https://a.com/x", "https://b.com"])).toEqual(["https://a.com/x", "https://b.com"]);
  });
});

describe("GitHub 與 Instagram 連結", () => {
  it("GitHub 專案連結統一成 owner/repo，子頁面也算同一個專案", () => {
    const a = parseLink("https://github.com/shadcn-ui/ui/tree/main/apps?tab=readme")!;
    const b = parseLink("https://www.github.com/Shadcn-UI/ui.git")!;
    expect(a.githubRepo).toBe("shadcn-ui/ui");
    expect(a.canonical).toBe("https://github.com/shadcn-ui/ui");
    expect(a.key).toBe(b.key);
  });
  it("GitHub 非專案頁面不當成專案", () => {
    expect(parseLink("https://github.com/trending/typescript")!.githubRepo).toBeUndefined();
    expect(parseLink("https://github.com/someone")!.githubRepo).toBeUndefined();
  });
  it("Instagram Reel 去掉追蹤參數後去重", () => {
    const a = parseLink("https://www.instagram.com/reel/DezD0vhzvvL/?utm_source=ig_web_copy_link&psln=MzRl&srtk=MzRl")!;
    const b = parseLink("https://instagram.com/reels/DezD0vhzvvL")!;
    expect(a.key).toBe("instagram:DezD0vhzvvL");
    expect(a.key).toBe(b.key);
    expect(a.canonical).toBe("https://www.instagram.com/reel/DezD0vhzvvL/");
  });
  it("一般網站去掉 utm 參數但保留其他參數", () => {
    const a = parseLink("https://dribbble.com/shots/1?utm_source=x&page=2")!;
    expect(a.canonical).toBe("https://dribbble.com/shots/1?page=2");
    expect(a.key).toBe(parseLink("https://www.dribbble.com/shots/1?page=2")!.key);
  });
});

describe("讀取貼文 meta", () => {
  it("內文含引號與 HTML entity 不會被截斷", () => {
    const html = `<meta property="og:title" content="王小明 (@ming.w) on Threads"><meta content="I'm building &amp; shipping &#x1F680; 每天" property="og:description">`;
    expect(getMeta(html, "og:description")).toBe("I'm building & shipping 🚀 每天");
    expect(parseOpenGraph(html)).toMatchObject({ content: "I'm building & shipping 🚀 每天", author: "@ming.w", imageUrl: null });
  });

  it("登入牆的通用描述不算內容", () => {
    expect(isUsefulText("Join Threads to share ideas, ask questions, post random thoughts, and more.")).toBe(false);
    expect(isUsefulText("Log in with your Instagram")).toBe(false);
    expect(isUsefulText("")).toBe(false);
    expect(isUsefulText("用遊戲化讓人每天運動")).toBe(true);
    expect(parseOpenGraph(`<meta property="og:description" content="Join Threads to share ideas">`)).toBeNull();
    // 有登入牆但有預覽圖：內容為 null、保留圖片（設計類貼文靠圖分析）
    expect(
      parseOpenGraph(`<meta property="og:description" content="Join Threads to share ideas"><meta property="og:image" content="https://cdn.x/a.jpg">`),
    ).toMatchObject({ content: null, imageUrl: "https://cdn.x/a.jpg" });
  });

  it("嵌入 HTML 轉純文字", () => {
    expect(htmlToText(`<blockquote><p>第一行<br>第二行</p><script>x()</script></blockquote>`)).toBe("第一行\n第二行");
  });
});

describe("評分", () => {
  it("分數限制在 1～10 並四捨五入", () => {
    expect(clampScore(12)).toBe(10);
    expect(clampScore(0)).toBe(1);
    expect(clampScore("7.6")).toBe(8);
    expect(clampScore("abc")).toBeNull();
    expect(clampScore(undefined)).toBeNull();
  });
  it("綜合分數 = 40/30/30 加權，缺值時以剩下的權重計算", () => {
    expect(totalScore(10, 5, 5)).toBe(7);
    expect(totalScore(8, null, 6)).toBe(7.1);
    expect(totalScore(null, null, null)).toBeNull();
  });
  it("分類與標籤清理", () => {
    expect(normalizeCategory("marketing")).toBe("marketing");
    expect(normalizeCategory("random")).toBe("other");
    expect(cleanTags(["#健身", "健身", " 社群 ", 3, "a", "b", "c", "d"])).toEqual(["健身", "社群", "a", "b", "c"]);
    expect(cleanTags("x")).toEqual([]);
  });
});

describe("日期與提醒", () => {
  it("台北時間跨日：UTC 16:30 已是台北隔天", () => {
    const d = new Date("2026-11-01T16:30:00Z"); // 台北 11/2（週一）00:30
    expect(taipeiDate(d)).toBe("2026-11-02");
    expect(taipeiWeekday(d)).toBe(1);
    // Cron 在 UTC 13:00 執行 = 台北 21:00，週日
    expect(taipeiWeekday(new Date("2026-11-01T13:00:00Z"))).toBe(0);
  });
  it("天數差與日期格式", () => {
    expect(daysBetween("2026-10-30", "2026-11-13")).toBe(14);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-11-13")).toBe(true);
    expect(isIsoDate(null)).toBe(false);
  });
  it("14 天、3 天各提醒一次，錯過 14 天直接進 3 天也只提醒一次", () => {
    const t = "2026-10-30";
    expect(reminderFor(t, "2026-11-13", false, false)).toBe("14");
    expect(reminderFor(t, "2026-11-13", true, false)).toBeNull();
    expect(reminderFor(t, "2026-11-10", false, false)).toBe("14"); // 10 天，之前沒提醒過也補提醒
    expect(reminderFor(t, "2026-11-02", false, false)).toBe("3");
    expect(reminderFor(t, "2026-11-02", true, true)).toBeNull();
    expect(reminderFor(t, "2026-10-30", true, false)).toBe("3"); // 當天
    expect(reminderFor(t, "2026-10-29", false, false)).toBeNull(); // 已截止
    expect(reminderFor(t, "2026-12-30", false, false)).toBeNull();
    expect(reminderFor(t, null, false, false)).toBeNull();
  });
});

describe("補助去重", () => {
  it("網址相同但追蹤參數不同視為同一筆，保留 id 類參數", () => {
    expect(grantKey("A", "https://www.ustart.yda.gov.tw/plan/?utm_source=x")).toBe(grantKey("A 計畫", "https://ustart.yda.gov.tw/plan"));
    expect(grantKey("A", "https://x.gov.tw/news?id=1")).not.toBe(grantKey("A", "https://x.gov.tw/news?id=2"));
  });
  it("沒有網址時用名稱（忽略空白與大小寫）", () => {
    expect(grantKey("U-Start 創新創業計畫", null)).toBe(grantKey("u-start創新創業計畫", undefined));
  });
});

describe("設計簡報", () => {
  it("逐則列出連結、圖片、風格、手法、GitHub 資訊與補充", () => {
    const md = buildBrief(
      [
        { summary: "毛玻璃儀表板", category: "ui_design", url: "https://x.com/a", note: "想學\n膠囊導覽", imageUrl: "https://img/1", design: { styles: ["毛玻璃", "粉紫漸層"], learn: ["膠囊分頁"], apply: "用在 ideabox 首頁" } },
        { summary: "元件庫", category: "github", url: "https://github.com/a/b", note: null, design: { github: { repo: "a/b", stars: 12345, language: "TypeScript", license: "MIT", pushed_at: "2026-10-27T00:00:00Z", description: "UI kit" } } },
      ],
      "2026-10-30",
      () => "3 天前",
    );
    expect(md).toContain("共 2 則");
    expect(md).toContain("## 1. 毛玻璃儀表板");
    expect(md).toContain("- 預覽圖：https://img/1");
    expect(md).toContain("- 風格：毛玻璃、粉紫漸層");
    expect(md).toContain("  - 膠囊分頁");
    expect(md).toContain("- 我的補充：想學 膠囊導覽");
    expect(md).toContain("- 類型：GitHub 資源");
    expect(md).toContain("a/b・⭐ 12k・TypeScript・MIT・更新於 3 天前");
  });
  it("清單清理：去重、截斷、限制數量", () => {
    expect(cleanList(["a", "a", " b ", 1, "c", "d", "e", "f"], 3)).toEqual(["a", "b", "c"]);
    expect(cleanList("x")).toEqual([]);
  });
  it("AI 輸出清理：切掉漏出的標記、丟掉沒意義的值", () => {
    expect(cleanText("好點子。</summary> <parameter name=\"category\">other", 200)).toBe("好點子。");
    expect(cleanText("只有設計類才填：建議套用在哪個專案", 200)).toBe("");
    expect(cleanText("[]", 200)).toBe("");
    expect(cleanText(" 無 ", 200)).toBe("");
    expect(cleanText("不適用，這是交易工具", 200)).toBe("不適用，這是交易工具");
    expect(isJunkText("N/A")).toBe(true);
    expect(cleanList(["[]", "膠囊分頁", "無"])).toEqual(["膠囊分頁"]);
  });
  it("新分類可被接受", () => {
    expect(normalizeCategory("ui_design")).toBe("ui_design");
    expect(normalizeCategory("github")).toBe("github");
  });
});

describe("台北時間格式", () => {
  it("跨日與補零", async () => {
    const { taipeiShort } = await import("@/lib/format");
    expect(taipeiShort("2026-10-30T16:05:00Z")).toBe("10/31 00:05");
    expect(taipeiShort("2026-10-30T01:02:00Z", false)).toBe("10/30");
  });
});
