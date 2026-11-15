import "server-only";
import { env } from "./env";

const api = (method: string) => `https://api.telegram.org/bot${env.telegramToken()}/${method}`;

export function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.error(`Telegram ${method} failed:`, json.description);
      return null;
    }
    return json.result ?? null;
  } catch (err) {
    console.error(`Telegram ${method} error`, err);
    return null;
  }
}

/** 訊息下方的按鈕（data 最長 64 bytes） */
export type Button = { text: string; data: string };
const keyboard = (rows: Button[][]) => ({ inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) });

/** 按下按鈕後的回應（不回應的話 Telegram 按鈕會一直轉圈） */
export async function answerCallback(id: string, text?: string) {
  await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
}

/** 換掉（或移除）某則訊息的按鈕 */
/** 改寫已送出的訊息內容（連按鈕一起換） */
export async function editMessage(chatId: number | string, messageId: number, html: string, rows: Button[][] | null) {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: rows ? keyboard(rows) : { inline_keyboard: [] },
  });
}

export async function setButtons(chatId: number | string, messageId: number, rows: Button[][] | null) {
  await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: rows ? keyboard(rows) : { inline_keyboard: [] } });
}

/**
 * 早期設定 webhook 時只收「訊息」，按鈕被按下的通知收不到。
 * 第一次要送按鈕前檢查一次，缺的話自動補上（不會清掉還沒處理的訊息）。
 */
export async function ensureCallbackUpdates(): Promise<void> {
  const info = await call<{ url: string; allowed_updates?: string[] }>("getWebhookInfo", {});
  if (!info?.url) return;
  const allowed = info.allowed_updates;
  if (!allowed || allowed.includes("callback_query")) return; // 沒限制（全部都收）或已包含
  await call("setWebhook", {
    url: info.url,
    secret_token: env.telegramWebhookSecret(),
    allowed_updates: [...new Set([...allowed, "message", "callback_query"])],
  });
}

/** 傳 HTML 格式訊息，超過長度自動切段。回傳最後一則訊息的 id。 */
export async function sendMessage(
  chatId: number | string,
  html: string,
  opts: { replyTo?: number; buttons?: Button[][] } = {},
): Promise<number | null> {
  const chunks = splitMessage(html, 3900);
  let lastId: number | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const r = await call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(opts.replyTo && i === 0 ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
      ...(opts.buttons?.length && i === chunks.length - 1 ? { reply_markup: keyboard(opts.buttons) } : {}),
    });
    if (r) lastId = r.message_id;
  }
  return lastId;
}

/** 傳給主人（TELEGRAM_OWNER_ID）。未設定時略過。 */
export async function sendToOwner(html: string): Promise<number | null> {
  const owner = env.telegramOwnerId();
  if (!owner) return null;
  return sendMessage(owner, html);
}

export async function sendToOwnerWithButtons(html: string, buttons: Button[][]): Promise<number | null> {
  const owner = env.telegramOwnerId();
  if (!owner) return null;
  return sendMessage(owner, html, { buttons });
}

export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

export async function downloadFile(fileId: string): Promise<{ mediaType: string; base64: string } | null> {
  const info = await call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!info?.file_path) return null;
  if (info.file_size && info.file_size > 5_000_000) return null; // Claude 圖片上限 5MB
  const res = await fetch(`https://api.telegram.org/file/bot${env.telegramToken()}/${info.file_path}`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = info.file_path.split(".").pop()?.toLowerCase();
  const mediaType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  return { mediaType, base64: buf.toString("base64") };
}

export async function getWebhookInfo() {
  return call<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
}

export async function sendTyping(chatId: number | string) {
  await call("sendChatAction", { chat_id: chatId, action: "typing" });
}
