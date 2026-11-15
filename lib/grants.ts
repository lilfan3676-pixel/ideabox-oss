import "server-only";
import { aiLangRule } from "./aiLang";
import { callClaude, type ContentBlock, type Message } from "./ai";
import { daysBetween, isIsoDate, reminderFor, taipeiDate } from "./dates";
import { db, type Grant } from "./db";
import { getOwnerContext, getOwnerProfile } from "./owner";
import { env } from "./env";
import { grantKey } from "./grantKey";
import { rulesPrompt } from "./learning";
import { clampScore } from "./scoring";
import { esc, sendToOwner } from "./telegram";

type FoundGrant = {
  name: string;
  organizer?: string;
  url?: string;
  amount?: string;
  eligibility?: string;
  deadline?: string | null;
  fit_score?: number;
  fit_reason?: string;
};

const REPORT_TOOL = {
  name: "report_grants",
  description: "回報這次找到、目前仍開放申請的補助／競賽／加速器清單",
  input_schema: {
    type: "object",
    properties: {
      grants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "計畫或競賽的正式名稱（含年度梯次）" },
            organizer: { type: "string", description: "主辦單位" },
            url: { type: "string", description: "官方說明或報名頁網址" },
            amount: { type: "string", description: "補助金額或獎金，未公布寫「未公布」" },
            eligibility: { type: "string", description: "申請資格重點，40 字內" },
            deadline: { type: ["string", "null"], description: "截止日 YYYY-MM-DD；常態受理或未公布填 null" },
            fit_score: { type: "integer", minimum: 1, maximum: 10, description: "對使用者的產品與身分的適合度" },
            fit_reason: { type: "string", description: "一句話說明為何適合或不適合" },
          },
          required: ["name", "url", "deadline", "fit_score", "fit_reason"],
        },
      },
    },
    required: ["grants"],
  },
};

/** 用 Claude + 網路搜尋找台灣目前開放的創業補助與競賽，寫入資料庫。回傳新增與更新筆數。 */
export async function runGrantRadar(budgetMs = 200_000): Promise<{ added: number; updated: number; found: number }> {
  const startedAt = Date.now();
  const today = taipeiDate();
  const [context, profile] = await Promise.all([getOwnerContext(), getOwnerProfile()]);
  const { data: known } = await db().from("grants").select("name").gte("deadline", today).limit(40);
  const knownNames = (known ?? []).map((g: { name: string }) => g.name).join("、");

  const system = [
    "你是台灣新創資源研究員，使用繁體中文。",
    `今天是 ${today}（台北時間）。`,
    `使用者：${profile}。產品：${context}`,
    "任務：用網路搜尋找出「目前仍開放申請、截止日在今天之後或常態受理」的台灣創業補助、政府計畫、創業競賽、加速器與校內創業資源，適合早期 App 團隊或學生團隊。",
    "可參考方向：教育部 U-start、經濟部中小及新創企業署（SBIR、創業相關計畫）、國科會、使用者所在縣市的青年創業補助、使用者學校或地區的育成與創業資源、大型創業競賽與加速器。",
    "只列出你在官方或可信頁面確認過的項目，不要猜測截止日。最多 15 筆。",
    "完成搜尋後，務必呼叫 report_grants 回報結果。",
    await rulesPrompt("grant"),
    await aiLangRule(),
  ]
    .filter(Boolean)
    .join("\n");

  const messages: Message[] = [
    {
      role: "user",
      content: `請開始搜尋。${knownNames ? `已知項目（仍可列出以更新資訊）：${knownNames}` : ""}`,
    },
  ];

  let found: FoundGrant[] | null = null;
  for (let turn = 0; turn < 6 && !found; turn++) {
    const remaining = budgetMs - (Date.now() - startedAt);
    if (remaining < 20_000) break; // 時間不夠了，避免超過伺服器執行上限
    const res = await callClaude(
      {
        model: env.researchModel(),
        max_tokens: 8000,
        system,
        messages,
        tools: [{ type: env.webSearchTool(), name: "web_search", max_uses: 10, user_location: { type: "approximate", country: "TW", timezone: "Asia/Taipei" } }, REPORT_TOOL],
      },
      remaining,
      "grant_radar",
    );
    const report = res.content.find(
      (b) => b.type === "tool_use" && (b as { name?: string }).name === "report_grants",
    ) as { input?: { grants?: FoundGrant[] } } | undefined;
    if (report) {
      found = Array.isArray(report.input?.grants) ? report.input!.grants! : [];
      break;
    }
    messages.push({ role: "assistant", content: res.content as ContentBlock[] });
    if (res.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "請現在呼叫 report_grants 回報結果。" });
    }
  }
  if (!found) throw new Error("補助雷達沒有回報結果");
  return saveGrants(found, today);
}

async function saveGrants(items: FoundGrant[], today: string) {
  const rows = new Map<string, Omit<Grant, "id" | "status" | "reminded_14" | "reminded_3" | "created_at">>();
  for (const g of items) {
    const name = String(g.name ?? "").trim();
    if (!name) continue;
    const deadline = isIsoDate(g.deadline) ? g.deadline : null;
    if (deadline && daysBetween(today, deadline) < 0) continue; // 已截止
    const url = typeof g.url === "string" && /^https?:\/\//.test(g.url) ? g.url.trim() : null;
    let key = grantKey(name, url);
    if (rows.has(key)) key = grantKey(name, null); // 同一頁面列了好幾個計畫時改用名稱區分
    if (rows.has(key)) continue;
    rows.set(key, {
      dedupe_key: key,
      name: name.slice(0, 200),
      organizer: g.organizer?.trim().slice(0, 100) || null,
      url,
      amount: g.amount?.trim().slice(0, 100) || null,
      eligibility: g.eligibility?.trim().slice(0, 300) || null,
      deadline,
      fit_score: clampScore(g.fit_score),
      fit_reason: g.fit_reason?.trim().slice(0, 300) || null,
      last_seen_at: new Date().toISOString(),
    });
  }
  if (!rows.size) return { added: 0, updated: 0, found: items.length };

  const keys = [...rows.keys()];
  const { data: existing } = await db().from("grants").select("id,dedupe_key,deadline").in("dedupe_key", keys);
  const byKey = new Map((existing ?? []).map((e: { id: string; dedupe_key: string; deadline: string | null }) => [e.dedupe_key, e]));

  let added = 0;
  let updated = 0;
  for (const [key, row] of rows) {
    const old = byKey.get(key);
    if (old) {
      const patch: Record<string, unknown> = { ...row };
      // 截止日變了（例如延長），重新允許提醒
      if (old.deadline !== row.deadline) {
        patch.reminded_14 = false;
        patch.reminded_3 = false;
      }
      const { error } = await db().from("grants").update(patch).eq("id", old.id);
      if (!error) updated++;
    } else {
      const { error } = await db().from("grants").insert(row);
      if (!error) added++;
    }
  }
  return { added, updated, found: items.length };
}

/** 截止前 14 天、3 天各提醒一次（只提醒「新的」與「有興趣」）。 */
export async function sendDeadlineReminders(): Promise<number> {
  const today = taipeiDate();
  const { data } = await db()
    .from("grants")
    .select("*")
    .in("status", ["new", "interested"])
    .gte("deadline", today)
    .order("deadline");
  let sent = 0;
  for (const g of (data ?? []) as Grant[]) {
    const kind = reminderFor(today, g.deadline, g.reminded_14, g.reminded_3);
    if (!kind) continue;
    const days = daysBetween(today, g.deadline!);
    const when = days === 0 ? "今天截止" : `還有 ${days} 天截止（${g.deadline}）`;
    const msg = [
      `⏰ <b>${esc(g.name)}</b> ${when}`,
      g.amount ? `💰 ${esc(g.amount)}` : "",
      g.fit_reason ? `💡 ${esc(g.fit_reason)}` : "",
      g.url ? esc(g.url) : "",
    ]
      .filter(Boolean)
      .join("\n");
    const id = await sendToOwner(msg);
    if (id === null) continue; // 沒送出就不標記，明天再試
    const patch = kind === "3" ? { reminded_3: true, reminded_14: true } : { reminded_14: true };
    await db().from("grants").update(patch).eq("id", g.id);
    sent++;
  }
  return sent;
}

export async function upcomingGrants(limitDays = 30, limit = 5): Promise<Grant[]> {
  const today = taipeiDate();
  const { data } = await db()
    .from("grants")
    .select("*")
    .in("status", ["new", "interested"])
    .gte("deadline", today)
    .order("deadline")
    .limit(30);
  return ((data ?? []) as Grant[]).filter((g) => daysBetween(today, g.deadline!) <= limitDays).slice(0, limit);
}
