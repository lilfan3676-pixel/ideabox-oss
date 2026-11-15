"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getL } from "@/lib/i18nServer";
import type { Translate } from "@/lib/i18n";
import { CATEGORY_LABEL, db, isDesign, type Idea } from "@/lib/db";
import { sendWeeklyDigest } from "@/lib/digest";
import { runGrantRadar } from "@/lib/grants";
import { cleanFolderName, FOLDER_COLORS } from "@/lib/folderLogic";
import { listFolders, moveToFolder } from "@/lib/folders";
import { removeImage } from "@/lib/images";
import { ingestLink, ingestText, reanalyze } from "@/lib/ideas";
import { rollDue } from "@/lib/costCalc";
import { normalizeCategory } from "@/lib/scoring";
import { grantSnapshot, ideaSnapshot, maybeLearn, recordSignal, runLearning } from "@/lib/learning";
import type { Grant } from "@/lib/db";
import { extractUrls, stripUrls } from "@/lib/threads";
import { uiThemeValue } from "@/lib/appLogic";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

async function getIdea(id: string): Promise<Idea | null> {
  if (!isUuid(id)) return null;
  const { data } = await db().from("ideas").select("*").eq("id", id).maybeSingle();
  return (data as Idea) ?? null;
}

// ---------- 點子 ----------

export type SavedItem = {
  id: string;
  folderId: string | null; // 存到哪個資料夾（AI 猜的，通知裡可以一鍵改）
  category: Idea["category"]; // 分類代碼，畫面依語言顯示名稱
  summary: string;
  status: Idea["status"];
  duplicate: boolean;
};
export type AddIdeaState = { at: number; items: SavedItem[]; failed: number; error?: string } | null;

function savedItem(idea: Idea, duplicate: boolean): SavedItem {
  return {
    id: idea.id,
    folderId: idea.folder_id ?? null,
    category: idea.category,
    summary: (idea.summary ?? idea.content ?? idea.url ?? "").slice(0, 80),
    status: idea.status,
    duplicate,
  };
}

/** 網頁上的「存入並分析」：回傳存到哪裡，讓畫面跳出通知 */
export async function addIdea(_prev: AddIdeaState, form: FormData): Promise<AddIdeaState> {
  await requireOwner();
  const L = await getL();
  const input = String(form.get("input") ?? "").trim();
  if (!input) return { at: Date.now(), items: [], failed: 0, error: L("請先貼上連結或寫下想法", "Paste a link or type an idea first") };
  const project = String(form.get("project") ?? "");
  const projectId = /^[0-9a-f-]{36}$/i.test(project) ? project : null;
  const items: SavedItem[] = [];
  let failed = 0;
  try {
    const urls = extractUrls(input).slice(0, 10);
    if (urls.length) {
      const note = stripUrls(input) || null;
      for (const u of urls) {
        const r = await ingestLink(u, urls.length === 1 ? note : null, projectId).catch(() => null);
        if (r) items.push(savedItem(r.idea, r.duplicate));
        else failed++;
      }
    } else {
      items.push(savedItem(await ingestText(input, projectId), false));
    }
  } catch (err) {
    return { at: Date.now(), items, failed: failed + 1, error: L("存的時候出錯了：", "Something went wrong while saving: ") + String(err instanceof Error ? err.message : err).slice(0, 100) };
  }
  revalidatePath("/");
  return { at: Date.now(), items, failed };
}

/** 改這則點子屬於哪個專案（空字串 = 不指定），並針對新專案重新分析 */
export async function setIdeaProject(id: string, projectId: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner();
  const L = await getL();
  const idea = await getIdea(String(id));
  if (!idea) return { ok: false };
  const next = /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : null;
  const { error } = await db().from("ideas").update({ project_id: next }).eq("id", idea.id);
  if (error) return { ok: false, error: L("請先執行 migration-013-slack-projects.sql", "Run migration-013-slack-projects.sql first") };
  await reanalyze({ ...idea, project_id: next }).catch(() => null);
  revalidatePath("/");
  return { ok: true };
}

export async function saveNote(form: FormData) {
  await requireOwner();
  const L = await getL();
  const idea = await getIdea(String(form.get("id")));
  if (!idea) return;
  const note = String(form.get("note") ?? "").trim().slice(0, 2000);
  if (note === (idea.note ?? "")) {
    await reanalyze(idea);
  } else {
    // 直接以表單內容取代（網頁上是完整編輯），再重新分析
    const { data } = await db().from("ideas").update({ note: note || null }).eq("id", idea.id).select().single();
    if (data) {
      const out = await reanalyze(data as Idea);
      if (note) {
        await recordSignal("idea", "note", out.id, { ...ideaSnapshot(out), added_note: note.slice(0, 300) });
        after(maybeLearn);
      }
    }
  }
  revalidatePath("/");
}

export async function setCategory(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id"));
  if (!isUuid(id)) return;
  await db().from("ideas").update({ category: normalizeCategory(form.get("category")) }).eq("id", id);
  revalidatePath("/");
}

/** 採用／取消採用：畫面先切換，這裡存好回報結果（to＝要改成的狀態，連按兩下也不會亂掉） */
export async function toggleAdopted(id: string, to: boolean): Promise<{ ok: boolean }> {
  await requireOwner();
  const idea = await getIdea(String(id));
  if (!idea) return { ok: false };
  if (!!idea.adopted === to) return { ok: true };
  const { error } = await db().from("ideas").update({ adopted: to }).eq("id", idea.id);
  if (error) return { ok: false };
  await recordSignal("idea", to ? "adopt" : "unadopt", idea.id, ideaSnapshot(idea));
  after(maybeLearn);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteIdea(form: FormData) {
  await requireOwner();
  const L = await getL();
  const idea = await getIdea(String(form.get("id")));
  if (!idea) return;
  await db().from("ideas").delete().eq("id", idea.id);
  await removeImage(idea.image_path);
  // 分析過的才記（還沒分析的刪掉多半是貼錯）
  if (idea.status === "analyzed") {
    await recordSignal("idea", "delete", idea.id, ideaSnapshot(idea));
    after(maybeLearn);
  }
  revalidatePath("/");
}

// ---------- 資料夾 ----------

const isUuidOrNull = (s: string) => s === "" || isUuid(s);

export type FolderResult = { ok: boolean; error?: string };

export async function createFolder(name: string): Promise<FolderResult> {
  await requireOwner();
  const L = await getL();
  const clean = cleanFolderName(name);
  if (!clean) return { ok: false, error: L("請輸入資料夾名稱", "Enter a folder name") };
  const { folders, ready } = await listFolders();
  if (!ready) return { ok: false, error: L("請先執行 migration-010-folders.sql", "Run migration-010-folders.sql first") };
  if (folders.some((f) => f.name === clean)) return { ok: false, error: L("已經有同名的資料夾", "A folder with that name already exists") };
  const sort = Math.max(0, ...folders.map((f) => f.sort)) + 10;
  const { error } = await db().from("folders").insert({ name: clean, sort });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function renameFolder(id: string, name: string): Promise<FolderResult> {
  await requireOwner();
  const L = await getL();
  const clean = cleanFolderName(name);
  if (!isUuid(id) || !clean) return { ok: false, error: L("請輸入資料夾名稱", "Enter a folder name") };
  const { folders } = await listFolders();
  if (folders.some((f) => f.name === clean && f.id !== id)) return { ok: false, error: L("已經有同名的資料夾", "A folder with that name already exists") };
  const { error } = await db().from("folders").update({ name: clean }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/** 換顏色（空字串 = 跟著主題色） */
export async function setFolderColor(id: string, color: string): Promise<FolderResult> {
  await requireOwner();
  const L = await getL();
  if (!isUuid(id) || (color !== "" && !(color in FOLDER_COLORS))) return { ok: false };
  const { error } = await db().from("folders").update({ color: color || null }).eq("id", id);
  if (error) return { ok: false, error: L("請先在 ideabox 的 Supabase 執行 migration-011-folder-color.sql", "Run migration-011-folder-color.sql on the ideabox Supabase first") };
  revalidatePath("/");
  return { ok: true };
}

/** 刪資料夾：裡面的點子不會刪，會變成「未分類」 */
export async function deleteFolder(id: string): Promise<FolderResult> {
  await requireOwner();
  if (!isUuid(id)) return { ok: false };
  await db().from("ideas").update({ folder_id: null }).eq("folder_id", id);
  const { error } = await db().from("folders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function reorderFolders(ids: string[]): Promise<FolderResult> {
  await requireOwner();
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && isUuid(x)).slice(0, 100);
  await Promise.all(clean.map((id, n) => db().from("folders").update({ sort: (n + 1) * 10 }).eq("id", id)));
  revalidatePath("/");
  return { ok: true };
}

/** 搬移點子到資料夾（folderId 空字串 = 未分類） */
export async function moveIdeas(ids: string[], folderId: string): Promise<FolderResult & { moved?: number }> {
  await requireOwner();
  const clean = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && isUuid(x)).slice(0, 500);
  if (!clean.length || !isUuidOrNull(folderId)) return { ok: false };
  const moved = await moveToFolder(clean, folderId || null);
  revalidatePath("/");
  return { ok: moved > 0, moved };
}

// ---------- 設計簡報 ----------

/** 「可能重複」的提醒按了「不是重複」：清掉並且之後不再比對 */
export async function dismissDup(form: FormData) {
  await requireOwner();
  const idea = await getIdea(String(form.get("id")));
  if (!idea) return;
  await db().from("ideas").update({ dup_of: null, dup_dismissed: true }).eq("id", idea.id);
  revalidatePath("/");
}

/** 加入／移出設計簡報：跟採用一樣畫面先切換 */
export async function toggleBrief(id: string, to: boolean): Promise<{ ok: boolean }> {
  await requireOwner();
  const idea = await getIdea(String(id));
  if (!idea) return { ok: false };
  const { error } = await db().from("ideas").update({ in_brief: to }).eq("id", idea.id);
  if (error) return { ok: false };
  revalidatePath("/");
  return { ok: true };
}

export async function clearBrief() {
  await requireOwner();
  const L = await getL();
  await db().from("ideas").update({ in_brief: false }).eq("in_brief", true);
  revalidatePath("/");
  redirect("/?view=brief");
}

// ---------- 補助 ----------

const GRANT_STATUS = ["new", "interested", "applied", "ignored"] as const;

export async function setGrantStatus(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!isUuid(id) || !GRANT_STATUS.includes(status as (typeof GRANT_STATUS)[number])) return;
  const { data: g } = await db().from("grants").update({ status }).eq("id", id).select().maybeSingle();
  if (g && status !== "new") {
    await recordSignal("grant", status, id, grantSnapshot(g as Grant));
    after(maybeLearn);
  }
  revalidatePath("/grants");
}

export async function deleteGrant(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id"));
  if (!isUuid(id)) return;
  const { data: g } = await db().from("grants").delete().eq("id", id).select().maybeSingle();
  if (g) {
    await recordSignal("grant", "delete", id, grantSnapshot(g as Grant));
    after(maybeLearn);
  }
  revalidatePath("/grants");
}

export async function runRadarNow() {
  await requireOwner();
  const L = await getL();
  let msg = "";
  try {
    const r = await runGrantRadar(250_000);
    msg = L(`找到 ${r.found} 筆，新增 ${r.added}、更新 ${r.updated}`, `Found ${r.found}: ${r.added} new, ${r.updated} updated`);
  } catch (err) {
    msg = L("執行失敗：", "Failed: ") + String(err).slice(0, 120);
  }
  revalidatePath("/grants");
  redirect(`/grants?msg=${encodeURIComponent(msg)}`);
}

// ---------- 設定 ----------

/** 設定頁「專案描述」：每個專案一格，主要專案的同時寫回產品描述（補助雷達、週報用） */
export async function saveProjectDescriptions(form: FormData) {
  await requireOwner();
  const L = await getL();
  const { data } = await db().from("projects").select("id, slug, description");
  const { primaryProjectSlug } = await import("@/lib/owner");
  const main = primaryProjectSlug();
  let failed = false;
  for (const p of (data ?? []) as Array<{ id: string; slug: string; description: string | null }>) {
    const raw = form.get(`desc:${p.id}`);
    if (raw === null) continue; // 已完成的專案不在表單上，不動
    const value = String(raw).trim().slice(0, 2000);
    if (value !== (p.description ?? "").trim()) {
      const { error } = await db().from("projects").update({ description: value || null }).eq("id", p.id);
      if (error) failed = true;
    }
    if (main && p.slug === main && value) {
      await db().from("settings").upsert({ key: "owner_context", value, updated_at: new Date().toISOString() });
    }
  }
  revalidatePath("/settings");
  revalidatePath("/projects");
  redirect("/settings?msg=" + encodeURIComponent(failed ? L("有些沒存成功，請再試一次", "Some couldn't be saved, try again") : L("已儲存", "Saved")));
}

/** 設定頁：產品描述（還沒建專案時用）與「關於你」（找補助用） */
export async function saveOwnerContext(form: FormData) {
  await requireOwner();
  const L = await getL();
  for (const [field, key] of [["owner_context", "owner_context"], ["owner_profile", "owner_profile"]] as const) {
    if (!form.has(field)) continue;
    const value = String(form.get(field) ?? "").trim().slice(0, 2000);
    if (value) await db().from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
    else await db().from("settings").delete().eq("key", key);
  }
  revalidatePath("/settings");
  redirect("/settings?msg=" + encodeURIComponent(L("已儲存", "Saved")));
}

export async function sendDigestNow() {
  await requireOwner();
  const L = await getL();
  const ok = await sendWeeklyDigest().catch(() => false);
  redirect("/settings?view=digest&msg=" + encodeURIComponent(ok ? L("週報已傳到 Telegram", "Digest sent to Telegram") : L("傳送失敗，請確認 Bot 設定", "Couldn’t send — check the bot settings")));
}

// ---------- 產品監控 ----------

export async function runMonitorNow() {
  await requireOwner();
  const L = await getL();
  const { runMonitor } = await import("@/lib/monitor");
  let msg = "";
  try {
    const r = await runMonitor({ notify: true });
    msg = r.down ? L(`檢查完成：${r.down} 項異常`, `Check done: ${r.down} down`) : L(`檢查完成：${r.checked} 項全部正常`, `Check done: all ${r.checked} OK`);
  } catch (err) {
    msg = L("檢查失敗：", "Check failed: ") + String(err).slice(0, 120);
  }
  revalidatePath("/monitor");
  redirect(`/monitor?msg=${encodeURIComponent(msg)}`);
}

/** 監控頁：加一個要監控的網址 */
export async function addMonitorSite(form: FormData) {
  await requireOwner();
  const L = await getL();
  const { addSite, runMonitor } = await import("@/lib/monitor");
  const { cleanSiteUrl } = await import("@/lib/monitorLogic");
  const url = cleanSiteUrl(String(form.get("url") ?? ""));
  const name = String(form.get("name") ?? "").trim() || (url ? new URL(url).hostname : "");
  const slug = String(form.get("slug") ?? "").trim() || null;
  if (!url) redirect(`/monitor?msg=${encodeURIComponent(L("網址看起來不對，請貼完整網址（例如 https://example.com）", "That URL doesn't look right; paste the full URL (e.g. https://example.com)"))}`);
  await addSite({ name, url, slug });
  await runMonitor({ notify: false }).catch(() => null);
  revalidatePath("/monitor");
  redirect(`/monitor?msg=${encodeURIComponent(L(`已加入監控：${name}`, `Now monitoring: ${name}`))}`);
}

export async function removeMonitorSite(form: FormData) {
  await requireOwner();
  const L = await getL();
  const { removeSite } = await import("@/lib/monitor");
  await removeSite(String(form.get("id") ?? ""));
  revalidatePath("/monitor");
  redirect(`/monitor?msg=${encodeURIComponent(L("已停止監控", "Stopped monitoring"))}`);
}

/** 監控頁「立即健檢」：只更新畫面，不傳 Telegram */
export async function runHealthNow() {
  await requireOwner();
  const L = await getL();
  const { runHealthCheck } = await import("@/lib/health");
  let msg = "";
  try {
    const r = await runHealthCheck({ notify: false });
    msg = r.issues.length ? L(`健檢完成：發現 ${r.issues.length} 個問題`, `Health check done: ${r.issues.length} issue(s)`) : L("健檢完成：一切正常", "Health check done: all good");
  } catch (err) {
    msg = L("健檢失敗：", "Health check failed: ") + String(err).slice(0, 120);
  }
  revalidatePath("/monitor");
  redirect(`/monitor?msg=${encodeURIComponent(msg)}`);
}

// ---------- AI 自我學習 ----------

function learnMsg(msg: string): never {
  revalidatePath("/settings");
  redirect(`/settings?view=learn&msg=${encodeURIComponent(msg)}`);
}

export async function runLearningNow() {
  await requireOwner();
  const L = await getL();
  let msg = "";
  try {
    const r = await runLearning();
    msg = r === null
      ? L("目前沒有新的修正紀錄可以學習（或正在學習中）", "No new corrections to learn from (or learning is already running)")
      : L(`學習完成：點子規則 ${r.idea ?? "未變動"}、補助規則 ${r.grant ?? "未變動"}`, `Learning done: idea rules ${r.idea ?? "unchanged"}, grant rules ${r.grant ?? "unchanged"}`);
  } catch (err) {
    msg = L("學習失敗：", "Learning failed: ") + String(err).slice(0, 120);
  }
  learnMsg(msg);
}

/** 刪除規則：標成停用，AI 之後不會再學回來 */
export async function removeRule(form: FormData) {
  await requireOwner();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await db().from("learned_rules").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/settings");
}

export async function restoreRule(form: FormData) {
  await requireOwner();
  const id = Number(form.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await db().from("learned_rules").update({ active: true, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/settings");
}

// ---------- 成本 ----------

function costMsg(msg: string, view?: string): never {
  revalidatePath("/costs");
  redirect(`/costs?${view ? `view=${view}&` : ""}msg=${encodeURIComponent(msg)}`);
}

function parseExpense(form: FormData, L: Translate) {
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const product = String(form.get("product") ?? "shared");
  const kind = String(form.get("kind") ?? "");
  const amount = Number(String(form.get("amount") ?? "").replace(/,/g, ""));
  const currency = String(form.get("currency") ?? "TWD");
  const cycle = String(form.get("cycle") ?? "monthly");
  const date = String(form.get("date") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 200) || null;
  const started = String(form.get("started") ?? "");
  const view = kind === "one_time" ? "once" : "subs";
  if (!name) costMsg(L("請填名稱", "Enter a name"), view);
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(product)) costMsg(L("產品不正確", "Invalid product"), view);
  if (!["subscription", "one_time"].includes(kind)) costMsg(L("類型不正確", "Invalid type"), view);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) costMsg(L("金額格式不對", "Invalid amount"), view);
  if (!["TWD", "USD"].includes(currency)) costMsg(L("幣別不正確", "Invalid currency"), view);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) costMsg(kind === "one_time" ? L("請選付款日期", "Pick the payment date") : L("請選下次扣款日", "Pick the next billing date"), view);
  if (kind === "subscription" && !["monthly", "yearly"].includes(cycle)) costMsg(L("週期不正確", "Invalid billing cycle"), view);
  // 扣款日填了過去的日期，就直接推到下一期
  let due = date;
  if (kind === "subscription") {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    if (due < today) due = rollDue(due, cycle as "monthly" | "yearly", today);
  }
  return {
    view,
    row: {
      name,
      product,
      kind,
      amount,
      currency,
      cycle: kind === "subscription" ? cycle : null,
      next_due: kind === "subscription" ? due : null,
      paid_on: kind === "one_time" ? date : null,
      note,
      // 開始訂閱日（選填，migration-017）：沒填就不送這個欄位，還沒執行 migration 也能存
      ...(kind === "subscription" && /^\d{4}-\d{2}-\d{2}$/.test(started) ? { started_on: started } : {}),
    },
  };
}

export async function addExpense(form: FormData) {
  await requireOwner();
  const L = await getL();
  const { view, row } = parseExpense(form, L);
  const { error } = await db().from("expenses").insert(row);
  if (error) costMsg(L("新增失敗：", "Couldn’t add: ") + error.message, view);
  costMsg(L(`已新增「${row.name}」`, `Added “${row.name}”`), view);
}

export async function updateExpense(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id") ?? "");
  const { view, row } = parseExpense(form, L);
  // 改了扣款日就重新允許提醒
  const { error } = await db().from("expenses").update({ ...row, reminded_for: null }).eq("id", id);
  if (error) costMsg(L("更新失敗：", "Update failed: ") + error.message, view);
  costMsg(L("已更新", "Updated"), view);
}

/** 總預算金額（台幣），存在 settings.budget；起算日自動用第一筆成本紀錄那天 */
export async function saveBudget(form: FormData) {
  await requireOwner();
  const L = await getL();
  const total = Number(String(form.get("total") ?? "").replace(/[,\s]/g, ""));
  if (!Number.isFinite(total) || total <= 0 || total > 1_000_000_000) costMsg(L("預算金額格式不對", "Invalid budget amount"));
  await db().from("settings").upsert({ key: "budget", value: JSON.stringify({ total }), updated_at: new Date().toISOString() });
  costMsg(L("已更新總預算", "Budget updated"));
}

export async function toggleExpense(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id") ?? "");
  const active = String(form.get("active")) === "true";
  await db().from("expenses").update({ active: !active }).eq("id", id);
  costMsg(active ? L("已停用（不再計入、不再提醒）", "Paused (not counted, no reminders)") : L("已重新啟用", "Re-activated"), "subs");
}

export async function deleteExpense(form: FormData) {
  await requireOwner();
  const L = await getL();
  const id = String(form.get("id") ?? "");
  const view = String(form.get("view") ?? "");
  await db().from("expenses").delete().eq("id", id);
  costMsg(L("已刪除", "Deleted"), view || undefined);
}

// ---------- 介面語言 ----------

export async function setLang(lang: "zh" | "en") {
  await requireOwner();
  const L = await getL();
  if (lang !== "zh" && lang !== "en") return;
  const { cookies } = await import("next/headers");
  (await cookies()).set("ib-lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // AI 分析也依這個語言輸出（Telegram、排程等沒有 cookie 的地方從資料庫讀）
  await db().from("settings").upsert({ key: "ui_lang", value: lang, updated_at: new Date().toISOString() });
  revalidatePath("/", "layout");
}

/** 網頁切換主題時順便記到資料庫，手機 App 下次讀資料就跟著換 */
export async function saveUiTheme(theme: string, mode: string) {
  await requireOwner();
  const value = uiThemeValue(theme, mode);
  if (!value) return;
  await db().from("settings").upsert({ key: "ui_theme", value, updated_at: new Date().toISOString() });
}
