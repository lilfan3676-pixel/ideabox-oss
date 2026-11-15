import "server-only";
import { aiLangRule } from "./aiLang";
import { callStructured } from "./ai";
import { db, type Grant, type Idea } from "./db";
import { env } from "./env";
import { logError } from "./sysLog";

// AI 自我學習：記下你的修正（採用／刪除點子、補充備註、補助標記），
// 累積幾筆就整理成「偏好規則」，之後分析點子與找補助時自動參考。

export type Scope = "idea" | "grant";
export type Rule = { id: number; scope: Scope; rule: string; evidence: number; active: boolean; created_at: string; updated_at: string };

/** 累積幾筆新紀錄就自動學習一次 */
export const LEARN_BATCH = 5;
const MAX_RULES = 8;
const LOCK_KEY = "learning_lock";
const LOCK_MS = 5 * 60_000;

export function ideaSnapshot(i: Idea) {
  return {
    summary: i.summary ?? (i.content ?? "").slice(0, 120),
    category: i.category,
    tags: i.tags,
    score_total: i.score_total,
    score_reason: i.score_reason,
    note: i.note ? i.note.slice(0, 300) : null,
  };
}

export function grantSnapshot(g: Grant) {
  return { name: g.name, organizer: g.organizer, amount: g.amount, eligibility: g.eligibility, fit_score: g.fit_score, fit_reason: g.fit_reason };
}

/** 記一筆修正（失敗就忽略，不影響原本操作） */
export async function recordSignal(scope: Scope, action: string, refId: string | null, snapshot: Record<string, unknown>) {
  try {
    await db().from("feedback_signals").insert({ scope, action, ref_id: refId, snapshot });
  } catch {
    // 忽略
  }
}

/** 新紀錄累積到一定數量才學習（在 after() 裡呼叫，不拖慢畫面） */
export async function maybeLearn() {
  try {
    const { count } = await db().from("feedback_signals").select("id", { count: "exact", head: true }).eq("learned", false);
    if ((count ?? 0) >= LEARN_BATCH) await runLearning();
  } catch (err) {
    await logError("learning", err);
  }
}

export async function activeRules(scope: Scope): Promise<string[]> {
  try {
    const { data, error } = await db().from("learned_rules").select("rule").eq("scope", scope).eq("active", true).order("evidence", { ascending: false }).limit(MAX_RULES);
    if (error) return [];
    return (data ?? []).map((r: { rule: string }) => r.rule);
  } catch {
    return [];
  }
}

/** 給分析提示詞用的一段文字；沒有規則時回傳空字串 */
export async function rulesPrompt(scope: Scope): Promise<string> {
  const rules = await activeRules(scope);
  if (!rules.length) return "";
  const head =
    scope === "idea"
      ? "創業家的個人偏好（從他過去採用、刪除點子與補充備註中學到的，評分、分類與下一步建議都要反映這些偏好）："
      : "使用者的個人偏好（從他過去把補助標為有興趣、已申請或不適合中學到的，篩選與適合度評分要反映這些偏好）：";
  return [head, ...rules.map((r) => `- ${r}`)].join("\n");
}

const ACTION_TEXT: Record<string, string> = {
  adopt: "標為已採用",
  unadopt: "取消採用",
  delete: "刪除",
  note: "補充備註",
  interested: "標為有興趣",
  applied: "標為已申請",
  ignored: "標為不適合",
};

const SCHEMA = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      maxItems: MAX_RULES,
      items: {
        type: "object",
        properties: {
          rule: { type: "string", description: "一條具體的偏好規則，40 字以內，例如「重視能直接提高留存的社群功能，評分加重」" },
          evidence: { type: "integer", minimum: 1, description: "支持這條規則的紀錄數（沿用舊規則時加上新增的支持數）" },
        },
        required: ["rule", "evidence"],
      },
      description: "整理後的完整規則清單（包含要保留的舊規則）",
    },
  },
  required: ["rules"],
};

async function takeLock(): Promise<boolean> {
  const { data } = await db().from("settings").select("value").eq("key", LOCK_KEY).maybeSingle();
  const at = data ? Number((data as { value: string }).value) : 0;
  if (at && Date.now() - at < LOCK_MS) return false;
  await db().from("settings").upsert({ key: LOCK_KEY, value: String(Date.now()), updated_at: new Date().toISOString() });
  return true;
}
async function releaseLock() {
  await db().from("settings").delete().eq("key", LOCK_KEY);
}

/** 把還沒學過的紀錄整理成規則。回傳每個範圍更新後的規則數；沒有新紀錄時回傳 null。 */
export async function runLearning(): Promise<Partial<Record<Scope, number>> | null> {
  if (!(await takeLock())) return null;
  try {
    const { data, error } = await db().from("feedback_signals").select("*").eq("learned", false).order("at").limit(80);
    if (error) throw error;
    const signals = (data ?? []) as Array<{ id: number; scope: Scope; action: string; snapshot: Record<string, unknown> }>;
    if (!signals.length) return null;

    const result: Partial<Record<Scope, number>> = {};
    for (const scope of ["idea", "grant"] as Scope[]) {
      const mine = signals.filter((s) => s.scope === scope);
      if (!mine.length) continue;
      result[scope] = await learnScope(scope, mine);
    }
    await db().from("feedback_signals").update({ learned: true }).in("id", signals.map((s) => s.id));
    return result;
  } finally {
    await releaseLock().catch(() => null);
  }
}

async function learnScope(scope: Scope, signals: Array<{ action: string; snapshot: Record<string, unknown> }>): Promise<number> {
  const { data } = await db().from("learned_rules").select("*").eq("scope", scope);
  const all = (data ?? []) as Rule[];
  const current = all.filter((r) => r.active);
  const removed = all.filter((r) => !r.active).map((r) => r.rule);

  const lines = signals.map((s, n) => `${n + 1}. ${ACTION_TEXT[s.action] ?? s.action}：${JSON.stringify(s.snapshot)}`);
  const what = scope === "idea" ? "點子庫（Threads 等來源存的創業點子，AI 會摘要、分類、評分並建議下一步）" : "補助雷達（AI 上網找台灣的創業補助、競賽、加速器並評適合度）";
  const system = [
    "你是一個會從使用者行為中學習偏好的助理，所有輸出使用繁體中文。",
    `範圍：${what}。`,
    "根據使用者新的操作紀錄，更新「偏好規則」清單。規則會加進之後的 AI 提示詞，讓分析更符合他的口味。",
    "原則：",
    "- 只寫有根據的規則：至少 2 筆紀錄支持同一個傾向；使用者在備註裡直接說明的偏好，1 筆就可以成立。",
    "- 規則要具體、可執行（例如「行銷類點子若需要付費廣告，可行性評分降低」），不要空泛（例如「重視品質」）。",
    "- 保留仍然成立的舊規則（沿用原本的文字，evidence 加上新的支持數）；新紀錄明顯推翻的舊規則就拿掉；意思重複的合併。",
    `- 最多 ${MAX_RULES} 條，依重要程度排序。`,
    removed.length ? `- 使用者刪除過以下規則，不要再加回來或換句話說加回來：\n${removed.map((r) => `  ・${r}`).join("\n")}` : "",
    "- 「刪除」可能只是清掉重複或測試資料，單一筆刪除不足以成為規則。",
    await aiLangRule(),
  ]
    .filter(Boolean)
    .join("\n");
  const content = [
    current.length ? `目前的規則：\n${current.map((r) => `- ${r.rule}（支持 ${r.evidence} 筆）`).join("\n")}` : "目前還沒有規則。",
    `新的操作紀錄：\n${lines.join("\n")}`,
  ].join("\n\n");

  const r = await callStructured<{ rules: Array<{ rule: string; evidence: number }> }>({
    model: env.analyzeModel(),
    system,
    content,
    toolName: "save_rules",
    toolDescription: "儲存整理後的偏好規則清單",
    schema: SCHEMA,
    maxTokens: 1200,
    purpose: "learning",
  });

  const next = new Map<string, number>();
  for (const x of Array.isArray(r.rules) ? r.rules : []) {
    const text = String(x.rule ?? "").trim().slice(0, 120);
    if (!text || removed.includes(text)) continue;
    next.set(text, Math.max(1, Math.round(Number(x.evidence) || 1)));
    if (next.size >= MAX_RULES) break;
  }

  // AI 回傳空清單時不動既有規則（避免一次回應異常就把規則全部清掉）
  if (!next.size && current.length) return current.length;

  const now = new Date().toISOString();
  // 舊規則：清單裡還有的更新支持數，沒有的刪掉（不是使用者刪的，所以不標成 inactive）
  for (const old of current) {
    if (next.has(old.rule)) {
      await db().from("learned_rules").update({ evidence: next.get(old.rule), updated_at: now }).eq("id", old.id);
      next.delete(old.rule);
    } else {
      await db().from("learned_rules").delete().eq("id", old.id);
    }
  }
  if (next.size) {
    await db().from("learned_rules").insert([...next.entries()].map(([rule, evidence]) => ({ scope, rule, evidence })));
  }
  const { count } = await db().from("learned_rules").select("id", { count: "exact", head: true }).eq("scope", scope).eq("active", true);
  return count ?? 0;
}
