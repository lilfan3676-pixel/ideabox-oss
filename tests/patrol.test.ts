import { describe, expect, it } from "vitest";
import { MIN_SAMPLE, applyPatrol, engagement, features, findings, latestByScope, patrolForPlan, patrolStats, postsForPrompt, taipeiHour, takeaways, templateForPrompt, tidyText, toPatrolPosts, typeCounts, type PatrolPost, type PatrolReport } from "@/lib/patrolLogic";

// Threads 海巡的判斷邏輯：整理貼文、前段班跟其他比、AI 結果清理

const row = (i: number, over: Record<string, unknown> = {}) => ({
  record_type: "post",
  post_url: `https://www.threads.com/@user${i}/post/CODE${i}`,
  post_code: `CODE${i}`,
  username: `user${i}`,
  text_content: `這是第 ${i} 篇測試貼文的內容\n第二行在這裡`,
  like_count: 10 * i,
  reply_count: i,
  repost_count: 0,
  created_at: "2026-11-19T13:30:00+00:00",
  ...over,
});

const post = (over: Partial<PatrolPost> = {}): PatrolPost => ({ url: "https://www.threads.com/@a/post/1", author: "a", text: "一二三四五六七八九十", likes: 10, replies: 1, reposts: 0, views: null, at: null, images: [], type: null, x: 1, ...over });

describe("toPatrolPosts", () => {
  it("保留換行、去掉回覆與轉發與重複、照互動排、算出倍數", () => {
    const posts = toPatrolPosts([
      row(1),
      row(2),
      row(3),
      row(3), // 重複
      row(4, { is_reply: true }),
      row(5, { is_repost: true }),
      row(6, { record_type: "profile" }),
      row(7, { text_content: "太短" }),
      row(8, { post_url: "https://example.com/x" }),
    ]);
    expect(posts.map((p) => p.author)).toEqual(["user3", "user2", "user1"]);
    expect(posts[0].text).toContain("\n");
    expect(posts[1].x).toBe(1); // 中位數那篇
    expect(posts[0].x).toBeGreaterThan(1);
  });

  it("圖片：只收 https、不收影片、最多 4 張", () => {
    const [a] = toPatrolPosts([row(1, { media_urls: ["https://cdn.example/1.jpg", "http://cdn.example/2.jpg", "https://cdn.example/3.mp4?x=1", "https://cdn.example/4.jpg", "https://cdn.example/5.jpg", "https://cdn.example/6.jpg"], media_url: "https://cdn.example/1.jpg" })]);
    expect(a.images).toEqual(["https://cdn.example/1.jpg", "https://cdn.example/4.jpg", "https://cdn.example/5.jpg", "https://cdn.example/6.jpg"]);
    const [b] = toPatrolPosts([row(2, { media_type: "video", media_url: "https://cdn.example/v" })]);
    expect(b.images).toEqual([]);
  });

  it("觀看數沒有就是 null", () => {
    const [a, b] = toPatrolPosts([row(2, { view_count: 5000 }), row(1, { view_count: null })]);
    expect(a.views).toBe(5000);
    expect(b.views).toBeNull();
  });
});

describe("文字與特徵", () => {
  it("tidyText 把多餘空白與空行收掉", () => {
    expect(tidyText("第一行  有空白 \r\n\n\n\n第二行\t")).toBe("第一行 有空白\n\n第二行");
  });
  it("留言比讚重", () => {
    expect(engagement({ likes: 10, replies: 5, reposts: 1 })).toBe(27);
  });
  it("結尾是問句或請大家留言", () => {
    expect(features(post({ text: "今天去了駁二\n你們會自己去嗎？" })).question).toBe(true);
    expect(features(post({ text: "今天去了駁二\n想問大家都怎麼去" })).question).toBe(true);
    expect(features(post({ text: "為什麼會這樣？\n後來我就回家了。" })).question).toBe(false);
  });
  it("字數不算空白、行數不算空行、看得出連結與圖片", () => {
    const f = features(post({ text: "一二三\n\n四五 六\nhttps://example.com", images: ["x"] }));
    expect(f.lines).toBe(3);
    expect(f.link).toBe(true);
    expect(f.image).toBe(true);
  });
  it("台北時間的小時", () => {
    expect(taipeiHour("2026-11-19T13:30:00+00:00")).toBe(21);
    expect(taipeiHour("2026-11-19T20:00:00+00:00")).toBe(4);
    expect(taipeiHour(null)).toBeNull();
    expect(taipeiHour("亂寫")).toBeNull();
  });
});

describe("patrolStats", () => {
  it("樣本太少不比較", () => {
    const s = patrolStats(Array.from({ length: MIN_SAMPLE - 1 }, () => post()));
    expect(s.enough).toBe(false);
    expect(findings(s)).toEqual([]);
    expect(takeaways(s)).toEqual([]);
  });

  it("前段班短、愛問問題、留言多：數字卡與結論都講得出來", () => {
    const top = Array.from({ length: 5 }, (_, i) => post({ url: `t${i}`, text: "短短的一句話\n你們覺得呢？", likes: 100, replies: 60, at: "2026-11-19T13:30:00+00:00" }));
    const rest = Array.from({ length: 20 }, (_, i) => post({ url: `r${i}`, text: `${"很長的內容".repeat(30)}\n看這裡 https://example.com`, likes: 100, replies: 5 }));
    const s = patrolStats([...top, ...rest]);
    expect(s.enough).toBe(true);
    expect(s.top!.chars).toBeLessThan(s.rest!.chars);
    expect(s.top!.question).toBe(100);
    expect(s.rest!.question).toBe(0);
    expect(s.hours).toEqual({ from: 19, share: 100 }); // 21 點落在 19–22 這段（第一個包含它的時段）
    const keys = findings(s).map((f) => f.key);
    expect(keys).toEqual(["chars", "lines", "reply", "question", "image", "hours"]);
    const notes = takeaways(s).map((t) => t[0]).join("");
    expect(notes).toContain("比較短");
    expect(notes).toContain("問題");
    expect(notes).toContain("留言比例");
    expect(notes).toContain("連結");
  });
});

describe("applyPatrol", () => {
  const posts = () => [post({ url: "u1", author: "a1", x: 4 }), post({ url: "u2", author: "a2", x: 2 }), post({ url: "u3", author: "a3", x: 1 }), post({ url: "u4", author: "a4", x: 0.5 })];

  it("類型標回貼文、不認得的丟掉；模板要有 2 篇以上、一種一個、編號換成貼文", () => {
    const list = posts();
    const r = applyPatrol(
      {
        summary: " 短短的  最好 ",
        types: [{ n: 1, type: "question" }, { n: 2, type: "question" }, { n: 3, type: "story" }, { n: 4, type: "亂寫" }, { n: 99, type: "list" }],
        templates: [
          { type: "story", skeleton: "[只有一篇的類型]\n[不該出現]", why: "x", refs: [3] },
          { type: "question", skeleton: "**[一句情境]** ⏎ 想問大家：[問題]？", why: "回答門檻低", refs: [1, 1, 2, 77] },
          { type: "question", skeleton: "[重複的第二個]\n[不要]", why: "", refs: [] },
          { type: "nope", skeleton: "[不認得的類型]\n[不要]", why: "", refs: [] },
        ],
      },
      list,
    );
    expect(list.map((p) => p.type)).toEqual(["question", "question", "story", null]);
    expect(r.summary).toBe("短短的 最好");
    expect(r.types).toEqual([{ key: "question", n: 2, x: 3 }, { key: "story", n: 1, x: 1 }]);
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0].skeleton).toBe("[一句情境]\n想問大家：[問題]？");
    expect(r.templates[0].refs).toEqual([{ url: "u1", author: "a1" }, { url: "u2", author: "a2" }]);
  });

  it("AI 回傳壞掉的東西不會出錯", () => {
    const r = applyPatrol({ types: "x", templates: null } as never, posts());
    expect(r).toEqual({ summary: "", templates: [], types: [] });
  });

  it("typeCounts 篇數多的在前", () => {
    const list = [post({ type: "list", x: 1 }), post({ type: "story", x: 2 }), post({ type: "story", x: 4 })];
    expect(typeCounts(list).map((t) => t.key)).toEqual(["story", "list"]);
  });
});

describe("給 AI 的文字", () => {
  it("貼文清單用 ⏎ 表示換行、有圖會標出來", () => {
    const s = postsForPrompt([post({ text: "第一行\n第二行", images: ["x"], likes: 3, replies: 2, reposts: 1 })]);
    expect(s).toBe("[1] ♥3 💬2 🔁1 🖼｜第一行 ⏎ 第二行");
  });
  it("模板說明帶類型名稱與骨架", () => {
    const s = templateForPrompt({ type: "question", skeleton: "[情境]\n想問大家：[問題]？" });
    expect(s).toContain("提問互動");
    expect(s).toContain("[情境]\n想問大家：[問題]？");
    expect(s).toContain("不可以留下方括號");
  });
  it("排這週的參考：只列 2 篇以上的類型，倍數高的在前", () => {
    const s = patrolForPlan({ stats: { n: 3, enough: false }, types: [{ key: "list", n: 5, x: 1.2 }, { key: "question", n: 3, x: 2.4 }, { key: "story", n: 1, x: 9 }] });
    expect(s.split("\n")[0]).toContain("提問互動");
    expect(s).not.toContain("故事自白");
    expect(patrolForPlan(null)).toBe("");
  });
});

describe("latestByScope", () => {
  const rep = (over: Partial<PatrolReport>): PatrolReport => ({ id: "x", project_id: null, created_at: "2026-11-22T00:00:00Z", finished_at: null, status: "done", keywords: [], post_count: 0, result: { summary: "", stats: { n: 0, enough: false }, types: [], templates: [], posts: [] }, error: null, ...over });
  const now = Date.parse("2026-11-22T00:05:00Z");

  it("每個範圍拿最新完成的那份，狀態看最新一筆", () => {
    const r = latestByScope(
      [
        rep({ id: "old", project_id: "p1", created_at: "2026-11-15T00:00:00Z" }),
        rep({ id: "new", project_id: "p1", created_at: "2026-11-22T00:00:00Z", status: "running", result: null }),
        rep({ id: "g", created_at: "2026-11-21T00:00:00Z" }),
      ],
      now,
    );
    expect(r.p1.done?.id).toBe("old");
    expect(r.p1.state).toBe("running");
    expect(r.general.done?.id).toBe("g");
    expect(r.general.state).toBe("done");
  });

  it("抓取中超過 15 分鐘當作失敗", () => {
    const r = latestByScope([rep({ status: "running", result: null, created_at: "2026-11-21T23:00:00Z" })], now);
    expect(r.general.state).toBe("failed");
    expect(r.general.error).toBeTruthy();
  });
});
