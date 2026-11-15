import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db, type Idea } from "@/lib/db";
import { buildWeeklyDigest } from "@/lib/digest";
import { env } from "@/lib/env";
import { upcomingGrants } from "@/lib/grants";
import { addNoteAndReanalyze, attachPhoto, ingestPhoto, reanalyze, scoreLine } from "@/lib/ideas";
import { esc, sendMessage, sendTyping } from "@/lib/telegram";
import { askWhere, handleCallback, replyIdea, saveTo, type TgCallback } from "@/lib/tgFlow";
import { tgDestinations } from "@/lib/modules/registry";
import { forcedRoute, hasContent, routeMessage } from "@/lib/tgRoute";
import { extractUrls } from "@/lib/threads";
import { daysBetween, taipeiDate } from "@/lib/dates";

export const maxDuration = 120;

type TgEntity = { type: string; offset: number; length: number; url?: string };
type TgMessage = {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  entities?: TgEntity[];
  caption_entities?: TgEntity[];
  photo?: Array<{ file_id: string; file_size?: number; width: number }>;
  document?: { file_id: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number };
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(req: NextRequest) {
  // 1. 驗證請求真的來自 Telegram（設定 webhook 時帶的 secret）
  const secret = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(secret, env.telegramWebhookSecret())) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as { message?: TgMessage; callback_query?: TgCallback } | null;

  // 按鈕（存到哪裡、改存到…）：只接受主人按的
  const cb = update?.callback_query;
  if (cb) {
    const owner = env.telegramOwnerId();
    if (owner && String(cb.from?.id) === owner) {
      after(() =>
        handleCallback(cb).catch(async (err) => {
          console.error("telegram callback error", err);
          await (await import("@/lib/sysLog")).logError("telegram", err);
        }),
      );
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  if (!msg || !msg.from) return NextResponse.json({ ok: true });

  // 2. 先回 200 給 Telegram，避免它因為等太久而重送；真正的處理放在 after()
  after(() =>
    handleMessage(msg).catch(async (err) => {
      console.error("telegram handler error", err);
      const { logError } = await import("@/lib/sysLog");
      await logError("telegram", err);
    }),
  );
  return NextResponse.json({ ok: true });
}

const HELP = () => [
  "👋 我是你的點子收集 Bot。",
  "",
  "・在 Threads 按「分享」→ Telegram → 傳給我，就會存進點子庫並自動分析",
  "・一則訊息可以貼好幾個連結；連結旁打的字會當成你的補充",
  "・也可以直接傳截圖或打字記下想法",
  "・存好後 AI 會自動放進資料夾，按下面的資料夾按鈕可以改",
  ...tgDestinations().flatMap((d) => [
    `・會自動判斷要存進點子庫還是 ${d.label}，拿不準時會跳按鈕問你`,
    `・存錯了可以按回覆下方的「改存到…」；也可以開頭打「${d.prefixes[0]}」或「點子」直接指定`,
  ]),
  "・讀不到內容時，回覆我那則提示訊息補一句重點即可",
  "",
  "<b>專案進度</b>",
  "・「專案」看各專案做到哪",
  "・「<短名> 下一步 做好友動態」「<短名> 下一階段」「<短名> 階段 上架審核」",
  "・「<短名> 記錄 修好地圖」「<短名> 里程碑 12/1 正式上架」",
  "・「<短名> 排程 11/20-11/25 封測第二輪」：加到專案頁的月曆",
  "",
  "指令：/top 本週最高分　/grants 近期截止補助　/week 立即產生週報",
];

async function handleMessage(msg: TgMessage) {
  const chatId = msg.chat.id;
  const owner = env.telegramOwnerId();
  const fromId = String(msg.from!.id);
  const text = (msg.text ?? msg.caption ?? "").trim();

  // 3. 只服務主人。尚未設定主人 ID 時，告訴對方他的 ID 方便設定
  if (!owner) {
    await sendMessage(chatId, `你的 Telegram ID 是 <code>${fromId}</code>\n請把它填到 Vercel 環境變數 TELEGRAM_OWNER_ID，重新部署後就能開始使用。`);
    return;
  }
  if (fromId !== owner || msg.chat.type !== "private") return;

  await sendTyping(chatId);

  // 4. 指令
  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : "";
  if (cmd === "/start" || cmd === "/help") return void (await sendMessage(chatId, HELP().join("\n")));
  if (cmd === "/week") return void (await sendMessage(chatId, await buildWeeklyDigest()));
  if (cmd === "/top") return void (await sendMessage(chatId, await topThisWeek()));
  if (cmd === "/grants") return void (await sendMessage(chatId, await grantsList()));
  if (cmd === "/myid") return void (await sendMessage(chatId, `你的 ID：<code>${fromId}</code>`));

  const entityUrls = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])]
    .filter((e) => e.type === "text_link" && e.url)
    .map((e) => e.url!);

  // 4a. 專案進度：「專案」、「<短名> 下一步 ＿＿」「<短名> 下一階段」「<短名> 記錄 ＿＿」「<短名> 里程碑 12/1 ＿＿」
  //     要在 4b 之前，不然專案短名剛好是其他存放地點的指定字時會被搶走
  if (text && !msg.photo && !msg.reply_to_message && (!cmd || /^\/projects?$/.test(cmd))) {
    const { handleProjectText } = await import("@/lib/projects");
    const reply = await handleProjectText(cmd ? "專案" : text).catch(async (err) => {
      await (await import("@/lib/sysLog")).logError("telegram", err);
      return "❌ 更新專案時出錯了，請再試一次。";
    });
    if (reply) return void (await sendMessage(chatId, reply, { replyTo: msg.message_id }));
  }

  // 4b. 開頭指定：其他存放地點的指定字（模組）→ 存到那裡，「點子 …」→ 點子庫
  const dests = tgDestinations();
  const forced = !cmd ? forcedRoute(text, dests) : null;
  if (forced) {
    const body = [forced.body, ...entityUrls].filter(Boolean).join(" ");
    if (!body) return void (await sendMessage(chatId, "在「點子」後面貼上連結或文字，例如：點子 https://www.threads.com/…", { replyTo: msg.message_id }));
    await saveTo(forced.route, chatId, body, msg.message_id, { moveButton: true });
    return;
  }

  // 5. 回覆 Bot 的提示訊息 → 補充文字或截圖到那則點子
  const replyPhoto = msg.photo?.length ? msg.photo[msg.photo.length - 1].file_id : msg.document?.mime_type?.startsWith("image/") ? msg.document.file_id : null;
  if (msg.reply_to_message && (replyPhoto || (text && !extractUrls(text).length))) {
    const { data } = await db()
      .from("ideas")
      .select("*")
      .eq("telegram_message_id", msg.reply_to_message.message_id)
      .maybeSingle();
    if (data) {
      let idea = data as Idea;
      if (replyPhoto) idea = await attachPhoto(idea, replyPhoto);
      idea = text ? await addNoteAndReanalyze(idea, text) : await reanalyze(idea);
      await replyIdea(chatId, idea, false, msg.message_id);
      return;
    }
  }

  // 6. 連結：有其他存放地點時先讀內容，用關鍵字判斷要進點子庫還是那裡，拿不準就問
  const urls = extractUrls(text, entityUrls).slice(0, 10);
  if (urls.length) {
    const reader = dests.find((d) => d.readLink)?.readLink;
    const reads = reader ? await Promise.all(urls.slice(0, 2).map((u) => reader(u).catch(() => null))) : [];
    const fetched = reads.filter(Boolean).join("\n");
    const body = [text, ...entityUrls.filter((u) => !text.includes(u))].filter(Boolean).join(" ");
    // 連結內容讀不到（或只有按讚數這種空殼）、文字也沒線索 → 問你要存哪裡
    const { route } = routeMessage(text, urls, fetched, dests, { unreadable: !!reader && !reads.some(hasContent) });
    if (route === "ask") await askWhere(chatId, body, msg.message_id);
    else if (route !== "ideas") await saveTo(route, chatId, body, msg.message_id, { moveButton: true });
    else await saveTo("ideas", chatId, text, msg.message_id, { moveButton: true, extraUrls: entityUrls });
    return;
  }

  // 7. 截圖（照片或以檔案傳送的圖片）
  const photo = msg.photo?.length ? msg.photo[msg.photo.length - 1] : null;
  const imageDoc = msg.document?.mime_type?.startsWith("image/") ? msg.document : null;
  const fileId = photo?.file_id ?? imageDoc?.file_id;
  if (fileId) {
    try {
      const idea = await ingestPhoto(fileId, text || null);
      await replyIdea(chatId, idea, false, msg.message_id, { move: false });
    } catch (err) {
      console.error("ingestPhoto failed", err);
      await (await import("@/lib/sysLog")).logError("telegram", err);
      await sendMessage(chatId, "❌ 存截圖時出錯了，請再傳一次。", { replyTo: msg.message_id });
    }
    return;
  }

  // 8. 純文字想法
  if (text && !cmd) {
    if (text.length < 4) return void (await sendMessage(chatId, "太短了，多寫幾個字我才知道怎麼分析 🙂"));
    const { route } = routeMessage(text, [], "", dests);
    if (route === "ask") await askWhere(chatId, text, msg.message_id);
    else await saveTo(route, chatId, text, msg.message_id, { moveButton: true });
    return;
  }

  await sendMessage(chatId, HELP().join("\n"));
}

async function topThisWeek(): Promise<string> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await db()
    .from("ideas")
    .select("*")
    .eq("status", "analyzed")
    .not("category", "in", "(ui_design,github)")
    .gte("created_at", since)
    .order("score_total", { ascending: false, nullsFirst: false })
    .limit(5);
  const ideas = (data ?? []) as Idea[];
  if (!ideas.length) return "這週還沒有分析完成的點子。";
  return ["🏆 <b>本週最高分</b>", ...ideas.map((i, n) => `${n + 1}. ${esc(i.summary)}\n   ${scoreLine(i)}`)].join("\n");
}

async function grantsList(): Promise<string> {
  const list = await upcomingGrants(60, 8);
  if (!list.length) return "60 天內沒有要截止的補助／競賽（每週日晚上會自動更新）。";
  const today = taipeiDate();
  return [
    "🏦 <b>60 天內截止</b>",
    ...list.map((g) => `・${esc(g.name)}（${g.deadline}，剩 ${daysBetween(today, g.deadline!)} 天）`),
  ].join("\n");
}
