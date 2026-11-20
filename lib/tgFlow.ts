import "server-only";
import { bestFit } from "./scoring";
import { randomBytes } from "node:crypto";
import { db, type Idea } from "./db";
import { env } from "./env";
import { listFolders, moveToFolder, type Folder } from "./folders";
import { formatIdeaReply, ingestLink, ingestText } from "./ideas";
import { removeImage } from "./images";
import { ideaProjects } from "./projects";
import type { Project } from "./projectLogic";
import { answerCallback, editMessage, ensureCallbackUpdates, esc, sendMessage, setButtons, type Button } from "./telegram";
import { extractUrls, stripUrls } from "./threads";
import { tgDestinations } from "./modules/registry";
import type { TgDestination } from "./modules/types";

// Telegram 分流：存進點子庫或模組提供的其他地點（lib/modules）、拿不準時問你、存錯了可以一鍵改存。
// 其他地點的按鈕代碼：第 1 個是 mi:／r:…:m，第 2 個以後是 mi1:／r:…:m1（依此類推）。
// 按鈕需要的資料暫存在 settings（key = tg:<token>），7 天後由每日排程清掉。

const TOKEN_PREFIX = "tg:";

export async function putToken(payload: Record<string, unknown>): Promise<string> {
  const token = randomBytes(6).toString("base64url");
  await db().from("settings").upsert({ key: TOKEN_PREFIX + token, value: JSON.stringify(payload), updated_at: new Date().toISOString() });
  return token;
}
async function takeToken<T>(token: string, keep = false): Promise<T | null> {
  const key = TOKEN_PREFIX + token.replace(/[^A-Za-z0-9_-]/g, "");
  const { data } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  if (!data) return null;
  if (!keep) await db().from("settings").delete().eq("key", key);
  try {
    return JSON.parse((data as { value: string }).value) as T;
  } catch {
    return null;
  }
}

/** 第一次要送按鈕前，確認 webhook 收得到按鈕通知（只檢查一次） */
async function buttonsReady() {
  const { data } = await db().from("settings").select("value").eq("key", "tg_callback_ok").maybeSingle();
  if (data) return;
  await ensureCallbackUpdates();
  await db().from("settings").upsert({ key: "tg_callback_ok", value: "1", updated_at: new Date().toISOString() });
}

const dests = () => tgDestinations();
const destCode = (n: number) => (n === 0 ? "" : String(n));
function destOf(code: string): TgDestination | undefined {
  return dests()[code === "" ? 0 : Number(code)];
}
/** 「改存到 X」按鈕（點子庫 → 其他地點） */
const named = (d: TgDestination) => (d.icon ? `${d.icon} ${d.label}` : d.label);
const moveButtons = (ideaId: string): Button[][] => dests().map((d, n) => [{ text: `${d.icon ? `${d.icon} ` : ""}改存到 ${d.label}`, data: `mi${destCode(n)}:${ideaId}` }]);

// ---------- 資料夾與專案按鈕 ----------

type FolderToken = { id: string; f: string[]; move: boolean; p?: string[] }; // move：要不要附「改存到其他地點」
type Names = { folders: Map<string, string>; projects: Map<string, string> };
const FOLDER_BUTTONS_MAX = 12;
const PROJECT_BUTTONS_MAX = 6;

function rowsOf(btns: Button[], per = 3): Button[][] {
  const rows: Button[][] = [];
  for (let n = 0; n < btns.length; n += per) rows.push(btns.slice(n, n + per));
  return rows;
}

function folderRows(p: FolderToken, token: string, names: Names, current: { folder: string | null; project: string | null }): Button[][] {
  const rows = rowsOf(p.f.map((fid, n) => ({ text: `${fid === current.folder ? "✓ " : ""}${names.folders.get(fid) ?? "?"}`, data: `fd:${token}:${n}` })));
  // 這則是哪個專案的點子：按了會針對那個專案重新評分，再按一次取消
  if (p.p?.length) rows.push(...rowsOf(p.p.map((pid, n) => ({ text: `${pid === current.project ? "✓ " : "🏷 "}${names.projects.get(pid) ?? "?"}`, data: `pj:${token}:${n}` }))));
  if (p.move) rows.push(...moveButtons(p.id));
  return rows;
}

async function loadNames(): Promise<Names & { folderList: Folder[]; projectList: Project[] }> {
  const [{ folders }, { projects, ready }] = await Promise.all([listFolders(), ideaProjects().catch(() => ({ projects: [] as Project[], ready: false }))]);
  const projectList = ready ? projects.slice(0, PROJECT_BUTTONS_MAX) : [];
  return {
    folders: new Map(folders.map((f) => [f.id, f.name])),
    projects: new Map(projectList.map((x) => [x.id, x.name])),
    folderList: folders,
    projectList,
  };
}

/** 存好的回覆附上資料夾按鈕（AI 猜的打勾）與專案按鈕 */
async function ideaButtons(idea: Idea, n: Awaited<ReturnType<typeof loadNames>>, move: boolean): Promise<Button[][] | undefined> {
  const fs = n.folderList.slice(0, FOLDER_BUTTONS_MAX);
  if (!fs.length && !n.projectList.length) return move && dests().length ? moveButtons(idea.id) : undefined;
  const p: FolderToken = { id: idea.id, f: fs.map((f) => f.id), move, p: n.projectList.map((x) => x.id) };
  const token = await putToken(p);
  return folderRows(p, token, n, { folder: idea.folder_id, project: idea.project_id ?? null });
}

// ---------- 存進點子庫 ----------

/** 回覆結果並記下 Bot 訊息 id，之後「回覆這則訊息」就能對應到這個點子。
 *  buttons：附資料夾按鈕（move = 再加「改存到其他地點」，沒有其他地點時不加） */
export async function replyIdea(chatId: number, idea: Idea, duplicate: boolean, replyTo: number, buttons?: { move: boolean }) {
  const n = await loadNames();
  let rows: Button[][] | undefined;
  if (buttons) {
    await buttonsReady();
    rows = await ideaButtons(idea, n, buttons.move);
  }
  const text = formatIdeaReply(idea, duplicate, n.folders.get(idea.folder_id ?? ""), idea.project_id ? n.projects.get(idea.project_id) : n.projects.get(bestFit(idea.scoring?.projects)?.id ?? "") ?? null);
  const botMsgId = await sendMessage(chatId, text, { replyTo, buttons: rows });
  if (botMsgId) await db().from("ideas").update({ telegram_message_id: botMsgId }).eq("id", idea.id);
}

export async function saveToIdeas(chatId: number, text: string, replyTo: number, opts: { moveButton: boolean; extraUrls?: string[] }) {
  const move = () => ({ move: opts.moveButton && dests().length > 0 });
  const urls = extractUrls(text, opts.extraUrls ?? []).slice(0, 10);
  if (urls.length) {
    const note = stripUrls(text) || null;
    for (const url of urls) {
      try {
        const r = await ingestLink(url, urls.length === 1 ? note : null);
        if (r) await replyIdea(chatId, r.idea, r.duplicate, replyTo, r.duplicate ? undefined : move());
      } catch (err) {
        console.error("ingestLink failed", url, err);
        await (await import("./sysLog")).logError("telegram", err);
        await sendMessage(chatId, `❌ 存這個連結時出錯了：${esc(url)}`, { replyTo });
      }
    }
    if (urls.length > 1 && note) await sendMessage(chatId, "ℹ️ 一次傳多個連結時，旁邊的文字不會套到每一則；要補充請回覆個別的結果訊息。");
    return;
  }
  if (text.trim().length < 4) {
    await sendMessage(chatId, "太短了，多寫幾個字我才知道怎麼分析 🙂", { replyTo });
    return;
  }
  const idea = await ingestText(text);
  await replyIdea(chatId, idea, false, replyTo, move());
}

// ---------- 存到其他地點（模組） ----------

export async function saveToDest(dest: TgDestination, chatId: number, body: string, replyTo: number, opts: { moveButton: boolean }) {
  try {
    const r = await dest.save(body);
    let buttons: Button[][] | undefined;
    if (opts.moveButton) {
      await buttonsReady();
      buttons = [[{ text: "💡 改存到點子庫", data: `mv:${await putToken({ text: body, dest: dest.key, undo: r.undo ?? null })}` }]];
    }
    await sendMessage(chatId, r.text, { replyTo, buttons });
  } catch (err) {
    console.error("save to", dest.key, "failed", err);
    await (await import("./sysLog")).logError("telegram", err);
    await sendMessage(chatId, `❌ 存到 ${esc(dest.label)} 時出錯了，請再傳一次。`, { replyTo });
  }
}

/** 依 key 存到其他地點（找不到就存點子庫） */
export async function saveTo(route: string, chatId: number, body: string, replyTo: number, opts: { moveButton: boolean; extraUrls?: string[] }) {
  const d = dests().find((x) => x.key === route);
  if (d) return saveToDest(d, chatId, body, replyTo, opts);
  return saveToIdeas(chatId, body, replyTo, opts);
}

// ---------- 拿不準：問你 ----------

export async function askWhere(chatId: number, text: string, replyTo: number) {
  await buttonsReady();
  const token = await putToken({ text, replyTo });
  const list = dests();
  await sendMessage(chatId, "🤔 這則要存到哪裡？", {
    replyTo,
    buttons: [[
      { text: "💡 點子庫", data: `r:${token}:i` },
      ...list.map((d, n) => ({ text: named(d), data: `r:${token}:m${destCode(n)}` })),
      ...(list.length === 1 ? [{ text: "兩邊都存", data: `r:${token}:b` }] : []),
    ]],
  });
}

// ---------- 按鈕 ----------

export type TgCallback = { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number } } };

export async function handleCallback(cb: TgCallback) {
  const chatId = cb.message?.chat.id;
  const msgId = cb.message?.message_id;
  const data = cb.data ?? "";
  if (!chatId || !msgId) return void (await answerCallback(cb.id));

  // 這則要存到哪裡？
  if (data.startsWith("r:")) {
    const [, token, choice] = data.split(":");
    const p = await takeToken<{ text: string; replyTo: number }>(token);
    if (!p) return void (await answerCallback(cb.id, "這個選項已經處理過了"));
    const dest = choice === "b" ? destOf("") : choice?.startsWith("m") ? destOf(choice.slice(1)) : undefined;
    await answerCallback(cb.id, choice === "i" ? "存到點子庫" : choice === "b" ? "兩邊都存" : `存到 ${dest?.label ?? "點子庫"}`);
    await setButtons(chatId, msgId, null);
    if (choice === "i" || choice === "b" || !dest) await saveToIdeas(chatId, p.text, p.replyTo, { moveButton: choice === "i" });
    if (dest) await saveToDest(dest, chatId, p.text, p.replyTo, { moveButton: choice !== "b" });
    return;
  }

  // 搬到別的資料夾（按鈕留著，可以再改；打勾跟著移動）
  if (data.startsWith("fd:")) {
    const [, token, n] = data.split(":");
    const p = await takeToken<FolderToken>(token, true);
    const folderId = p?.f[Number(n)];
    if (!p || !folderId) return void (await answerCallback(cb.id, "這個選項已經過期了，請到網站上搬移"));
    const moved = await moveToFolder([p.id], folderId).catch(() => 0);
    if (!moved) return void (await answerCallback(cb.id, "搬不過去：這則或這個資料夾已經不在了"));
    const names = await loadNames();
    const { data: row } = await db().from("ideas").select("*").eq("id", p.id).maybeSingle();
    await answerCallback(cb.id, `已搬到「${names.folders.get(folderId) ?? "資料夾"}」`);
    await setButtons(chatId, msgId, folderRows(p, token, names, { folder: folderId, project: (row as Idea | null)?.project_id ?? null }));
    return;
  }

  // 這則是哪個專案的點子：針對那個專案重新分析，改寫原本的回覆
  if (data.startsWith("pj:")) {
    const [, token, n] = data.split(":");
    const p = await takeToken<FolderToken>(token, true);
    const projectId = p?.p?.[Number(n)];
    if (!p || !projectId) return void (await answerCallback(cb.id, "這個選項已經過期了，請到網站上改"));
    const { data: row } = await db().from("ideas").select("*").eq("id", p.id).maybeSingle();
    const idea = row as Idea | null;
    if (!idea) return void (await answerCallback(cb.id, "這則已經不在點子庫了"));
    const names = await loadNames();
    const next = idea.project_id === projectId ? null : projectId;
    const { error } = await db().from("ideas").update({ project_id: next }).eq("id", idea.id);
    if (error) return void (await answerCallback(cb.id, "請先執行 migration-013"));
    await answerCallback(cb.id, next ? `改成「${names.projects.get(next) ?? "專案"}」，重新分析中…` : "取消指定專案，重新分析中…");
    await setButtons(chatId, msgId, null);
    const { reanalyze } = await import("./ideas");
    const fresh = await reanalyze({ ...idea, project_id: next });
    const text = formatIdeaReply(fresh, false, names.folders.get(fresh.folder_id ?? ""), next ? names.projects.get(next) : names.projects.get(bestFit(fresh.scoring?.projects)?.id ?? "") ?? null);
    await editMessage(chatId, msgId, text, folderRows(p, token, names, { folder: fresh.folder_id, project: next }));
    return;
  }

  // 點子庫 → 其他地點
  const mi = data.match(/^mi(\d*):(.+)$/);
  if (mi) {
    const dest = destOf(mi[1]);
    const id = mi[2];
    if (!dest) return void (await answerCallback(cb.id, "這個選項已經過期了"));
    const { data: row } = await db().from("ideas").select("*").eq("id", id).maybeSingle();
    const idea = row as Idea | null;
    if (!idea) return void (await answerCallback(cb.id, "這則已經不在點子庫了"));
    await answerCallback(cb.id, `改存到 ${dest.label}`);
    await setButtons(chatId, msgId, null);
    const body = [idea.url, idea.note, idea.url ? null : idea.content].filter(Boolean).join("\n");
    await db().from("ideas").delete().eq("id", idea.id);
    await removeImage(idea.image_path).catch(() => null);
    await saveToDest(dest, chatId, body, msgId, { moveButton: false });
    return;
  }

  // 其他地點 → 點子庫（模組決定要刪掉哪些剛存的資料）
  if (data.startsWith("mv:")) {
    const p = await takeToken<{ text: string; dest?: string; undo?: unknown }>(data.slice(3));
    if (!p) return void (await answerCallback(cb.id, "這個選項已經處理過了"));
    await answerCallback(cb.id, "改存到點子庫");
    await setButtons(chatId, msgId, null);
    const dest = dests().find((d) => d.key === p.dest);
    if (dest?.undo && p.undo != null) await dest.undo(p.undo).catch((e) => console.error("undo failed", e));
    await saveToIdeas(chatId, p.text, msgId, { moveButton: false });
    return;
  }

  // Slack 自動更新改回來
  if (data.startsWith("pu:")) {
    const p = await takeToken<{ undo: string; stage: number; next: string | null; ms: string[]; ev?: string[] }>(data.slice(3));
    if (!p) return void (await answerCallback(cb.id, "這個選項已經處理過了"));
    const { getProject, updateProject } = await import("./projects");
    const proj = await getProject(p.undo);
    if (!proj) return void (await answerCallback(cb.id, "這個專案已經不在了"));
    await updateProject(proj, { stage: p.stage, next_step: p.next }, "manual");
    if (p.ms?.length) await db().from("project_milestones").delete().in("id", p.ms);
    if (p.ev?.length) await db().from("project_events").delete().in("id", p.ev);
    await answerCallback(cb.id, "已改回來");
    await setButtons(chatId, msgId, null);
    await sendMessage(chatId, `↩️ ${esc(proj.name)} 已改回原本的階段和下一步${p.ms?.length || p.ev?.length ? "，新增的里程碑、排程也刪掉了" : ""}`, { replyTo: msgId });
    return;
  }

  // 發文提醒：已發／延後 1 天／略過
  if (data.startsWith("po:")) {
    const { handlePostButton } = await import("./posts");
    const r = await handlePostButton(data);
    await answerCallback(cb.id, r.toast || undefined);
    if (r.done) await setButtons(chatId, msgId, null);
    if (r.text) await sendMessage(chatId, r.text, { replyTo: msgId });
    return;
  }

  // 每晚進度確認：里程碑做了／延期、下一步做完了
  if (data.startsWith("ck:")) {
    const { handleCheckinButton } = await import("./checkin");
    const r = await handleCheckinButton(data);
    await answerCallback(cb.id, r.toast || undefined);
    if (r.done) await setButtons(chatId, msgId, null);
    if (r.text) await sendMessage(chatId, r.text, { replyTo: msgId });
    return;
  }

  await answerCallback(cb.id);
}

/** 每日排程：清掉 7 天前還沒按的按鈕資料 */
export async function cleanupTokens() {
  const before = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await db().from("settings").delete().like("key", `${TOKEN_PREFIX}%`).lt("updated_at", before);
}
