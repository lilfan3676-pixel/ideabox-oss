// 互動（回覆留言、私訊、去別人貼文留言）與個人檔案健檢的規則（純函式）。
// AI 只寫草稿：不自動送出、不自動留言、不大量私訊沒互動過的人（平台會限制帳號）。

// ---------- 回覆自己貼文下面的留言 ----------

export const BUCKETS = ["keyword", "lead", "substance", "question", "support", "noise"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABEL: Record<Bucket, [string, string]> = {
  keyword: ["留關鍵字", "Keyword"],
  lead: ["可能的使用者", "Lead"],
  substance: ["有內容的回應", "Substance"],
  question: ["好問題", "Question"],
  support: ["支持", "Support"],
  noise: ["不用回", "Skip"],
};
/** 每一類怎麼處理（給 AI 的規則，也顯示在畫面上） */
export const BUCKET_HINT: Record<Bucket, [string, string]> = {
  keyword: ["他留了你請大家留的那個字：回一句，然後把答應的東西傳給他。", "They commented your keyword: reply, then send what you promised."],
  lead: ["他在描述你能解決的問題：公開把問題答完，最後一句才說可以幫忙。", "They describe the problem you solve: answer fully in public, then offer help."],
  substance: ["他補充、反對或延伸：值得寫最長的回覆。", "They add, disagree or extend: worth your longest reply."],
  question: ["很多人也想問的問題：先回，再考慮拍成一支 Reel。", "A question many people have: reply, then consider a Reel."],
  support: ["表情符號、「好棒」這種：按讚，回 3～8 個字就好。", "Emoji or “great post”: like it and reply in a few words."],
  noise: ["廣告、互追、來吵架的：不回。回了等於幫他曝光。", "Spam, follow-for-follow, bad faith: don't reply."],
};
export const MAX_COMMENTS = 60;

export type CommentIn = { n: number; who: string; text: string };
/** 把貼上的留言拆成一則一則：一行一則，前面的「@帳號：」「帳號 :」當作留言的人 */
export function parseComments(raw: string): CommentIn[] {
  const out: CommentIn[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(@?[\w.一-鿿]{1,30})\s*[:：]\s*(.+)$/);
    out.push({ n: out.length + 1, who: m ? (m[1].startsWith("@") ? m[1] : `@${m[1]}`) : "", text: (m ? m[2] : t).slice(0, 500) });
    if (out.length >= MAX_COMMENTS) break;
  }
  return out;
}

export type ReplyOut = { n: number; who: string; text: string; bucket: Bucket; reply: string; reel: boolean };
/** 檢查 AI 回來的分類與回覆：編號要對得上、不用回的不留回覆、只有好問題能標「拍成 Reel」 */
export function cleanReplies(raw: { replies?: unknown }, comments: CommentIn[]): ReplyOut[] {
  const list = Array.isArray(raw?.replies) ? (raw.replies as Record<string, unknown>[]) : [];
  const byN = new Map(list.map((r) => [Number(r?.n), r]));
  const order = (b: Bucket) => BUCKETS.indexOf(b);
  return comments
    .map((c) => {
      const r = byN.get(c.n);
      const bucket: Bucket = BUCKETS.includes(r?.bucket as Bucket) ? (r!.bucket as Bucket) : "support";
      const reply = bucket === "noise" ? "" : String(r?.reply ?? "").trim().slice(0, 600);
      return { ...c, bucket, reply, reel: bucket === "question" && r?.reel === true };
    })
    .sort((a, b) => order(a.bucket) - order(b.bucket) || a.n - b.n);
}
export function bucketCounts(list: Pick<ReplyOut, "bucket">[]): Record<Bucket, number> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  for (const r of list) out[r.bucket]++;
  return out;
}

export const REPLY_RULES = [
  "先把每則留言分到六類之一，再寫回覆：",
  ...BUCKETS.map((b) => `・${b}（${BUCKET_LABEL[b][0]}）：${BUCKET_HINT[b][0]}`),
  "回覆的寫法：",
  "・真的回答問題。他問怎麼做，就在回覆裡講怎麼做，不要叫他私訊才告訴他。",
  "・長度跟他的留言差不多。四個字的留言不要回四行。",
  "・有帳號的話開頭叫他一次，不加驚嘆號。",
  "・對批評：先承認他說對的部分，再講你的立場；不辯解、不回兩次。",
  "・noise 一律不寫回覆（reply 留空字串）。",
  "・reel 只有 question 類、而且看起來很多人都會想問的才填 true。",
  "・我沒給的事實不要編（價格、功能、日期）。不知道答案時用一句話說會確認再回就好，不要解釋為什麼不知道，也不要為了湊長度反問他。",
  "・我有寫「請大家留的字」時，留那個字（或意思一樣）的就是 keyword。",
].join("\n");

// ---------- 私訊 ----------

export const DM_KINDS = ["deliver", "warm", "collab"] as const;
export type DmKind = (typeof DM_KINDS)[number];
export const DM_LABEL: Record<DmKind, [string, string]> = {
  deliver: ["回覆舉手的人", "Reply to a raised hand"],
  warm: ["熟人的第一則", "First message to someone warm"],
  collab: ["合作提案", "Collab pitch"],
};
export const DM_HINT: Record<DmKind, [string, string]> = {
  deliver: ["他先留了關鍵字、回了限動或投了票。第一則就把答應的東西給他，不要先問問題。", "They commented, replied to a story or voted first. Send what you promised in message one."],
  warm: ["你已經在他的貼文下面互動一陣子了。2～4 句，講具體的那件事，先給再問。", "You've been engaging with their posts. Two to four sentences, specific, give before asking."],
  collab: ["給特定帳號的具體提案：你看到他做了什麼、想一起做什麼、他得到什麼、你需要他做什麼。", "A specific proposal: what you've seen them do, the idea, what they get, what you need."],
};
export const DM_STYLE: Record<DmKind, string> = {
  deliver: "這是回覆一個先舉手的人（他留了關鍵字、回了限動或投了票）。格式：第一行叫他的名字並直接把答應的東西給他（東西或去哪裡拿）；第二行一句話講怎麼用；最後一個他四個字就能回答的問題。不要「在給你之前想先問」這種先卡住再給的寫法。",
  warm: "這是傳給一個已經互動過一陣子的人的第一則訊息。2～4 句：提到他具體發過或說過的那件事（用他的話）、先給一個有用的東西（數字、做法、答案）、最後只問一件小事。不放連結、不放預約表單、稱讚和提案不要放在同一則。",
  collab: "這是給特定帳號的合作提案。四行，照順序：你看到他做了什麼（具體）、想一起做的那件事、他會得到什麼、你需要他做什麼。講清楚誰做什麼，不要客套開場。",
};
export const DM_RULES = [
  "只寫我提供的事實：不要假裝看過他的內容、不要編共同朋友、不要編數字。",
  "沒有「今天為什麼要傳」的具體理由就不該傳：這種情況只輸出一句「沒有傳訊息的理由：先去他的貼文互動兩週再說。」",
  "不要用「嗨！想請教一個小問題」然後不問問題。",
  "追蹤訊息只有兩則：第 4 天那則一定要帶新的東西（不能只是「想確認你有沒有看到」）；第 10 天那則說清楚這是最後一則、之後不會再打擾。",
].join("\n");
export type DmOut = { message: string; follow4: string; follow10: string };

// ---------- 去別人的貼文留言 ----------

export const COMMENT_TYPES: [string, [string, string], string][] = [
  ["datum", ["補一個數字", "Add a datum"], "他講了一個論點，你能用自己的數字佐證"],
  ["case", ["補沒講到的情況", "Add the missing case"], "他說得對但不完整"],
  ["disagree", ["有禮貌地不同意", "Respectful disagree"], "你真的覺得不對：先講同意的部分，再講分歧"],
  ["extend", ["延伸其中一句", "Extend one line"], "裡面有一句特別好：引用它再往下講"],
  ["ask", ["問真正的問題", "Ask the real question"], "他跳過了最難的部分：問一個具體的問題"],
  ["receipt", ["我做過", "The receipt"], "你做過他講的事：兩句話講結果"],
  ["correct", ["更正", "The correction"], "有事實錯誤：要對、要短、要客氣"],
  ["reframe", ["換個角度", "The reframe"], "事實對但框架怪：換一種讀法"],
  ["oneliner", ["一句話", "The one-liner"], "不需要補充，只想露個臉：10 個字以內，要好笑或要真"],
];
export const commentTypeLabel = (key: string): [string, string] => COMMENT_TYPES.find((t) => t[0] === key)?.[1] ?? ["留言", "Comment"];
export const COMMENT_RULES = [
  "給兩則不同類型的留言，再用一句話說你會選哪一則、為什麼。",
  `類型：\n${COMMENT_TYPES.map(([k, l, when]) => `・${k}（${l[0]}）：${when}`).join("\n")}`,
  "・1～3 句。留言是在影片下面窄窄一欄讀的，一段話會被收起來。",
  "・不要用這些開頭：「好文」「太真實了」「說得太好了」「我也是」「推」，或叫對方名字加驚嘆號。",
  "・不要只留表情符號，第一個字也不要是表情符號。",
  "・不要重講貼文的內容，大家剛看完。只講一件事。",
  "・要具體：如果這則留言放在任何同主題的貼文下面都通，就不是留言。",
  "・絕對不要推銷：不提自己的產品、不放連結、不說「可以看我主頁」。",
  "・「我做過」「補數字」這兩類只能用我提供的經驗和數字，我沒給就不要選這兩類。",
].join("\n");
export type CommentOut = { options: { type: string; text: string }[]; pick: string };
export function cleanCommentOut(raw: Record<string, unknown>): CommentOut {
  const options = (Array.isArray(raw?.options) ? (raw.options as Record<string, unknown>[]) : [])
    .map((o) => ({ type: String(o?.type ?? ""), text: String(o?.text ?? "").trim().slice(0, 400) }))
    .filter((o) => o.text)
    .slice(0, 2);
  return { options, pick: String(raw?.pick ?? "").trim().slice(0, 200) };
}

// ---------- 個人檔案健檢 ----------

export type RubricItem = { id: string; points: number; label: [string, string]; full: string; fail: string };
/** 12 項、共 100 分。名稱欄、簡介第一行、置頂三則最重：陌生人從一支影片點進來，三秒內只看這些 */
export const PROFILE_RUBRIC: RubricItem[] = [
  { id: "name_field", points: 12, label: ["名稱欄", "Name field"], full: "名稱欄（頭像下面那行粗體字，不是帳號）有名字，加上別人會搜尋的字，例如「小安｜提案範本」。平台的搜尋會比對這一欄。", fail: "只有名字，或名字加一個表情符號。" },
  { id: "bio_first_line", points: 12, label: ["簡介第一行", "Bio first line"], full: "第一行講這是給誰的、對他有什麼改變，用對方的話講。不是職稱、不是形容詞清單。", fail: "「創業家｜咖啡成癮｜貓奴」。" },
  { id: "pinned_three", points: 10, label: ["置頂三則", "Pinned three"], full: "置頂三則各做一件事：最好的成果、最清楚的產品說明、最好的自我介紹。", fail: "沒有置頂，最上面就是最後發的那幾則。" },
  { id: "recent_activity", points: 10, label: ["最近有在發", "Recent activity"], full: "最近 7 天內有發文，而且最新一則的留言有回。", fail: "上一次發文是幾個月前，看起來像已經停了。" },
  { id: "bio_body", points: 8, label: ["簡介其他行", "Bio body"], full: "剩下的字放一個證明或一個具體的提案，讀起來是句子，不是用直線隔開的關鍵字。", fail: "關鍵字堆在一起，或整個空白。" },
  { id: "link", points: 8, label: ["連結", "Link"], full: "一個連結，去的地方跟簡介講的一致。超過兩個就變成選單，選單的效果比一扇門差。", fail: "連結頁有十幾個選項，或沒有連結。" },
  { id: "highlights", points: 8, label: ["精選動態", "Highlights"], full: "4～6 個精選，名字是對方會問的問題：怎麼玩、成果、常見問題、關於我們。封面一致。", fail: "「日常」「雜」「2023」，或十幾個沒有順序。" },
  { id: "grid_legibility", points: 8, label: ["前九張封面", "Grid covers"], full: "前九張封面縮成小圖還看得懂，不用點進去就知道這個帳號在講什麼。短影片的封面是挑過的。", fail: "九張都是講話講到一半的臉，沒有字。" },
  { id: "photo", points: 6, label: ["頭像", "Photo"], full: "個人帳號：臉佔圓圈六成、看得到眼睛。品牌帳號：標誌在很小的圓圈裡還認得出來。背景不搶戲。", fail: "全身照、太暗，或標誌的字小到看不見。" },
  { id: "handle", points: 6, label: ["帳號名稱", "Handle"], full: "好念、聽一次就拼得出來，跟其他平台同一個。沒有一串底線或用數字代替字母。", fail: "聽過一次也拼不出來的帳號。" },
  { id: "category_contact", points: 6, label: ["專業帳號與聯絡", "Category and contact"], full: "專業帳號，類別跟在做的事一致，聯絡按鈕能用。", fail: "個人帳號，所以沒有洞察報告，也沒有聯絡按鈕。" },
  { id: "offer_clear", points: 6, label: ["看得出下一步", "Clear next step"], full: "看完檔案知道下一步要做什麼：點連結、私訊、加好友，只有一個。", fail: "看完不知道這個帳號要我做什麼。" },
];
export const PROFILE_TOTAL = PROFILE_RUBRIC.reduce((s, r) => s + r.points, 0);

export const PROFILE_FIELDS = ["name", "handle", "bio", "link", "highlights", "pinned", "grid", "other"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const PROFILE_FIELD_LABEL: Record<ProfileField, [string, string]> = {
  name: ["名稱欄（頭像下面的粗體字）", "Name field (the bold line)"],
  handle: ["帳號（@ 後面）", "Handle"],
  bio: ["簡介", "Bio"],
  link: ["連結去哪裡", "Where the link goes"],
  highlights: ["精選動態的名字", "Highlight names"],
  pinned: ["置頂了哪幾則", "What's pinned"],
  grid: ["前九則大概是什麼", "The first nine posts"],
  other: ["其他（是不是專業帳號、最近多久發一次）", "Other (professional account? how often you post?)"],
};
export type ProfileInput = Partial<Record<ProfileField, string>>;
export function cleanProfileInput(v: unknown): ProfileInput {
  const out: ProfileInput = {};
  if (!v || typeof v !== "object") return out;
  for (const k of PROFILE_FIELDS) {
    const s = String((v as Record<string, unknown>)[k] ?? "").trim().slice(0, k === "bio" || k === "grid" ? 600 : 300);
    if (s) out[k] = s;
  }
  return out;
}

export type ProfileItem = { id: string; score: number; points: number; note: string; fix: string };
export type ProfileResult = { at: string; total: number; items: ProfileItem[]; input: ProfileInput };
/** 檢查 AI 的評分：每項不能超過滿分、沒評到的當 0 分；照「扣最多分」排 */
export function cleanProfile(raw: { items?: unknown }, input: ProfileInput, at: string): ProfileResult {
  const list = Array.isArray(raw?.items) ? (raw.items as Record<string, unknown>[]) : [];
  const byId = new Map(list.map((r) => [String(r?.id), r]));
  const items = PROFILE_RUBRIC.map((r) => {
    const got = byId.get(r.id);
    const score = Math.max(0, Math.min(r.points, Math.round(Number(got?.score) || 0)));
    return { id: r.id, score, points: r.points, note: String(got?.note ?? "").trim().slice(0, 200), fix: score >= r.points ? "" : String(got?.fix ?? "").trim().slice(0, 400) };
  }).sort((a, b) => b.points - b.score - (a.points - a.score) || b.points - a.points);
  return { at, total: items.reduce((s, i) => s + i.score, 0), items, input };
}
export const rubricLabel = (id: string): [string, string] => PROFILE_RUBRIC.find((r) => r.id === id)?.label ?? [id, id];

export const PROFILE_RULES = [
  "個人檔案不是讓人逛的店面，是一個「決定畫面」：陌生人從一支影片點進來，大約三秒決定要不要追蹤。",
  "照下面 12 項評分，每項給 0 到滿分之間的整數。要誠實：第一次健檢的檔案大多落在 30～40 分，給高分對他沒有幫助。",
  "看不到、我也沒寫的項目：不要猜，給 0 分，note 寫「沒有提供，沒辦法評」。",
  PROFILE_RUBRIC.map((r) => `・${r.id}（${r.label[0]}，${r.points} 分）滿分的樣子：${r.full} 常見的扣分：${r.fail}`).join("\n"),
  "每一項：note 用一句話講現在是什麼狀況（引用他實際寫的字）；沒拿滿分的，fix 給可以直接照抄的改法：",
  "・name_field 給三個選項，用「／」隔開，每個 30 個字元以內。",
  "・bio_first_line、bio_body 直接寫出改好的那一行。",
  "・pinned_three、highlights 寫出每一格該放什麼。",
  "・其他項目寫一句具體的做法。",
  "用繁體中文、台灣用語、白話。只能用我提供的事實，不要編成果或數字。",
].join("\n");
