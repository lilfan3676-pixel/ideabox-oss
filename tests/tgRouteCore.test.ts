// Telegram 分流的通用規則（沒有模組、或有一個其他存放地點時）
import { describe, expect, it } from "vitest";
import { forcedRoute, hasContent, routeMessage } from "@/lib/tgRoute";

const place = { key: "places", prefixes: ["地點"], score: (all: string) => ["咖啡廳", "甜點", "營業時間"].filter((w) => all.includes(w)).length };

describe("通用分流", () => {
  it("沒有其他存放地點：一律存點子庫（讀不到內容也一樣）", () => {
    expect(routeMessage("看看", ["https://www.instagram.com/p/x/"], "", [], { unreadable: true }).route).toBe("ideas");
    expect(routeMessage("咖啡廳甜點營業時間", []).route).toBe("ideas");
  });
  it("連結讀不到內容、文字也沒線索 → 問你", () => {
    expect(routeMessage("", ["https://www.instagram.com/p/x/"], "", [place], { unreadable: true }).route).toBe("ask");
    expect(routeMessage("這間好棒", ["https://www.instagram.com/p/x/"], "", [place], { unreadable: true }).route).toBe("ask");
  });
  it("讀不到內容但文字有線索：照原本規則", () => {
    expect(routeMessage("用排行榜提高 app 留存", ["https://www.instagram.com/p/x/"], "", [place], { unreadable: true }).route).toBe("ideas");
    expect(routeMessage("咖啡廳甜點好吃", ["https://www.instagram.com/p/x/"], "", [place], { unreadable: true }).route).toBe("places");
    expect(routeMessage("", ["https://github.com/a/b"], "", [place], { unreadable: true }).route).toBe("ideas");
  });
  it("讀得到內容、但兩邊都沒關鍵字 → 點子庫（跟以前一樣）", () => {
    expect(routeMessage("", ["https://x.com/a"], "今天天氣很好想出去走走", [place], { unreadable: false }).route).toBe("ideas");
  });
  it("開頭指定", () => {
    expect(forcedRoute("地點 某某咖啡", [place])).toEqual({ route: "places", body: "某某咖啡" });
    expect(forcedRoute("點子 某某", [place])).toEqual({ route: "ideas", body: "某某" });
    expect(forcedRoute("今天去地點", [place])).toBeNull();
  });
});

describe("連結內容有沒有實質內文", () => {
  it("讀不到、或只有按讚留言數 → 沒有", () => {
    expect(hasContent(null)).toBe(false);
    expect(hasContent("")).toBe(false);
    expect(hasContent("192 likes, 320 comments - shop_tw 於 October 31, 2026")).toBe(false);
    expect(hasContent("Instagram\n1.2K likes, 30 comments - someone on November 2, 2026")).toBe(false);
  });
  it("有內文 → 有", () => {
    expect(hasContent("192 likes - shop_tw: 鹽埕新開的咖啡廳，肉桂捲超好吃，營業到晚上十點")).toBe(true);
  });
});
