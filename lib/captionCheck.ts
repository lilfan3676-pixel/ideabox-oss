// 文案檢查（純函式，不花 AI 費用）：存檔前看「…更多」前面會露出什麼、行動呼籲、hashtag、
// 連結、表情符號、AI 腔用詞。規則是我們自己用中文寫的，判斷都很保守：拿不準就只提醒、不擋。
import { captionOf, type Platform, type PostFormat } from "./postLogic";

export type CheckLevel = "fail" | "warn";
export type CheckItem = { key: string; level: CheckLevel; text: [string, string] };
export type CaptionReport = {
  /** 這個格式有沒有要貼到平台上的文字（限動沒有） */
  hasCaption: boolean;
  /** 「…更多」之前會看到的字（只有 IG 算） */
  visible: string;
  /** 後面還有字、真的會被切掉 */
  cut: boolean;
  length: number;
  hashtags: string[];
  asks: string[];
  items: CheckItem[];
  verdict: "ok" | "warn" | "fail" | "empty";
};

/** IG 說明文字大約前 125 個字會直接露出來，後面要點「更多」 */
export const VISIBLE_CHARS = 125;
export const IG_MAX = 2200;
export const MAX_HASHTAGS = 5;

// 鍵盤打不出來的字元：零寬空白、連接符、方向標記、BOM、軟連字號、Unicode 標籤字元…貼上時常混進來
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|\uDB40[\uDC00-\uDC7F]/g;
// 表情符號裡的變體選擇符與連接符要留著（不然 ❤️、👨‍👩‍👧 會壞掉）
const EMOJI_GLUE = /(\p{Extended_Pictographic})((?:️|‍)+)/gu;

/** 拿掉看不見的字元、不換行空白換成一般空白。回傳清好的字和拿掉幾個 */
export function cleanInvisible(s: string): { text: string; removed: number } {
  const keep: string[] = [];
  const guarded = s.replace(EMOJI_GLUE, (_m, e: string, glue: string) => {
    keep.push(glue);
    return `${e}`;
  });
  let removed = 0;
  const cleaned = guarded
    .replace(INVISIBLE, () => {
      removed++;
      return "";
    })
    .replace(/[   ]/g, () => {
      removed++;
      return " ";
    });
  let i = 0;
  return { text: cleaned.replace(//g, () => keep[i++] ?? ""), removed };
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const URL = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|tw|net|org|io|app|me|co|cc|ly)\b(\/\S*)?/gi;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;
const GENERIC_TAGS = new Set(["#viral", "#fyp", "#foryou", "#foryoupage", "#explore", "#explorepage", "#instagood", "#like4like", "#followme", "#讚", "#追蹤", "#爆紅"]);

/** 行動呼籲的種類（同一種出現幾次都算一個） */
const ASKS: [string, [string, string], RegExp][] = [
  ["comment", ["留言", "comment"], /留言|底下(打|回)|在下面(打|回)|\+1|comment/i],
  ["dm", ["私訊", "DM"], /私訊|小盒子|\bdm\b|傳訊息給/i],
  ["save", ["收藏", "save"], /收藏|存起來|先存|\bsave\b/i],
  ["share", ["分享", "share"], /分享給|轉給|tag\s?你|標記(你|一個)|傳給(你的?)?(朋友|同學|室友)/i],
  ["follow", ["追蹤", "follow"], /追蹤(我|我們|起來)|按(個)?追蹤|\bfollow\b/i],
  ["link", ["點連結", "link"], /連結在|點(擊)?(主頁|簡介|個人檔案|bio)|(主頁|簡介|個人檔案|bio)[^。！？\n]{0,6}連結|link in bio/i],
  ["join", ["報名／加入", "sign up"], /報名|加(入|好友)|掃(描)?\s?qr|填(寫)?表單/i],
];

/** AI 腔用詞：中文貼文裡一看就像機器寫的說法（跟 AI 寫草稿的規則同一套方向） */
export const AI_TELLS: [string, RegExp][] = [
  ["不只是…更是", /不(只|僅)(是|僅)?[^。！？\n]{1,24}(更是|而是|還是一(種|個))/],
  ["讓我們一起", /讓我們一起|一起來(探索|看看|了解)/],
  ["在這個…的時代", /在這個[^。！？\n]{0,14}(時代|世代|年代)/],
  ["無論你是…還是", /(無論|不管)你是[^。！？\n]{1,20}還是/],
  ["探索", /探索/],
  ["打造", /打造/],
  ["賦能", /賦能|賦予(你|妳)?(全新|更多)/],
  ["旅程", /旅程/],
  ["解鎖", /解鎖/],
  ["無縫", /無縫|一站式/],
  ["值得一提的是", /值得一提的是|不可否認|總而言之|綜上所述|總的來說/],
  ["深入了解", /深入(了解|探討|剖析)/],
  ["至關重要", /至關重要|不可或缺|與眾不同|前所未有/],
  ["你準備好了嗎", /(你|妳)準備好了嗎|還在等什麼|快來(體驗|加入)吧/],
  ["delve / leverage", /\b(delve|leverage|seamless|unlock|game[- ]changer|elevate)\b/i],
];

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim() ?? "";

/** 檢查一則貼文。platform／format 決定套哪些規則：連結、hashtag 上限、「更多」只有 IG 嚴格算 */
export function checkCaption(body: string, platform: Platform, format: PostFormat = "post"): CaptionReport {
  const text = captionOf(body, format).trim();
  const whole = body.trim();
  const items: CheckItem[] = [];
  const add = (key: string, level: CheckLevel, zh: string, en: string) => items.push({ key, level, text: [zh, en] });
  const ig = platform === "ig";
  const hashtags = text.match(HASHTAG) ?? [];
  const asks = ASKS.filter(([, , re]) => re.test(text)).map(([k]) => k);
  const flat = text.replace(/\s*\n+\s*/g, " ");
  const base = { hasCaption: format !== "story", visible: ig ? flat.slice(0, VISIBLE_CHARS) : "", cut: flat.length > VISIBLE_CHARS, length: text.length, hashtags, asks };
  if (!whole) return { ...base, items, verdict: "empty" };

  // ---- 整篇都看（腳本也算）：AI 腔、破折號、粗體符號 ----
  const tells = AI_TELLS.filter(([, re]) => re.test(whole)).map(([name]) => name);
  if (tells.length) add("slop", "warn", `有 AI 腔的說法：${tells.slice(0, 5).join("、")}。換成你平常會講的話。`, `Sounds machine-written: ${tells.slice(0, 5).join(", ")}. Say it the way you'd say it.`);
  if (/——|—/.test(whole)) add("dash", "warn", "有破折號（——），真人打字很少用，改成逗號或直接斷句。", "Has em dashes. Use a comma or start a new sentence.");
  if (/\*\*[^*\n]+\*\*/.test(whole)) add("markdown", "warn", "有 ** 粗體符號，貼到平台上會直接顯示成星號。", "Has ** bold markers, which show up as asterisks on the platform.");
  if (cleanInvisible(whole).removed) add("invisible", "warn", "有看不見的字元（從別處貼上時混進來的），存檔時會自動清掉。", "Has invisible characters (from pasting). They're removed when you save.");

  if (format === "story") return { ...base, items, verdict: items.some((i) => i.level === "fail") ? "fail" : items.length ? "warn" : "ok" };
  if (!text) {
    add("nocaption", "warn", "腳本裡沒有「【貼文說明】」這一段，發文時還要另外寫說明文字。", "The script has no caption section yet.");
    return { ...base, items, verdict: "warn" };
  }

  // ---- 要貼到平台上的那段 ----
  const line1 = firstLine(text);
  if (ig && text.length > IG_MAX) add("long", "fail", `超過 IG 上限 ${IG_MAX} 字（現在 ${text.length} 字）。`, `Over Instagram's ${IG_MAX}-character limit (${text.length}).`);
  if (ig && URL.test(text)) add("link", "fail", "IG 的說明文字不能點連結，網址放了也沒用。改成「連結在主頁」或請對方留言、私訊。", "Links in an Instagram caption aren't clickable. Point to the bio or ask for a comment or DM.");
  URL.lastIndex = 0;
  if (ig && hashtags.length > MAX_HASHTAGS) add("tags", "fail", `hashtag 有 ${hashtags.length} 個，IG 一則最多 ${MAX_HASHTAGS} 個，多的不會有效果。`, `${hashtags.length} hashtags. Instagram counts at most ${MAX_HASHTAGS} per post.`);
  else if (!ig && hashtags.length > 8) add("tags", "warn", `hashtag 有 ${hashtags.length} 個，看起來像廣告，留 3～5 個就好。`, `${hashtags.length} hashtags reads like an ad. Keep 3 to 5.`);
  const generic = hashtags.filter((t) => GENERIC_TAGS.has(t.toLowerCase()));
  if (generic.length) add("generic", "warn", `${generic.join(" ")} 這種 hashtag 沒有描述任何東西，換成跟內容有關的或拿掉。`, `${generic.join(" ")} describe nothing. Use topic tags or drop them.`);
  if (/^#/.test(line1)) add("first-tag", "warn", "第一行就是 hashtag，「更多」前面的位置浪費掉了。", "The first line is a hashtag, which wastes the visible space.");
  else if (/^(大家好|哈囉|嗨|hi|hello|安安|各位)/i.test(line1)) add("greeting", "warn", "第一行是打招呼。「更多」前面只看得到開頭，直接講重點。", "The first line is a greeting. Lead with the point.");
  else if (/^\p{Extended_Pictographic}/u.test(line1)) add("first-emoji", "warn", "第一個字是表情符號，看起來像廣告，先放字。", "It opens with an emoji, which reads like an ad.");
  if (ig && format === "post" && line1.length > VISIBLE_CHARS) add("cut", "warn", `第一段有 ${line1.length} 個字，會在第 ${VISIBLE_CHARS} 個字被「…更多」切斷。把重點移到前面，或讓第一句短一點。`, `The first paragraph is ${line1.length} characters and gets cut at ${VISIBLE_CHARS}.`);
  const emoji = (text.match(EMOJI) ?? []).length;
  if (emoji > 3 && emoji / text.length > 0.04) add("emoji", "warn", `表情符號有 ${emoji} 個，太密了，整篇留 3 個以內。`, `${emoji} emoji is a lot. Keep it to 3.`);
  if (text.split("\n").filter((l) => /^\s*\p{Extended_Pictographic}/u.test(l)).length >= 3) add("emoji-list", "warn", "有三行以上用表情符號當開頭的條列，很像 AI 排的版。", "Three or more lines start with an emoji bullet.");
  if (asks.length === 0) add("noask", "warn", "沒有看到要讀者做的事。加一個行動：留言、收藏、私訊或怎麼加入，選一個。", "No ask. Add one: comment, save, DM or how to join.");
  else if (asks.length > 2) {
    const names = ASKS.filter(([k]) => asks.includes(k)).map(([, n]) => n[0]);
    add("asks", "warn", `同時要讀者做 ${asks.length} 件事（${names.join("、")}），通常一件都不會做。留一個最重要的。`, `${asks.length} asks at once. Keep the one that matters.`);
  }
  return { ...base, items, verdict: items.some((i) => i.level === "fail") ? "fail" : items.length ? "warn" : "ok" };
}
