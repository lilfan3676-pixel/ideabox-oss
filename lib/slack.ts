import "server-only";
import { callStructured } from "./ai";
import { taipeiDate } from "./dates";
import { db } from "./db";
import { env } from "./env";
import type { Milestone, Project } from "./projectLogic";
import { addEvent, addMilestone, listProjects, logActivity, updateProject } from "./projects";
import { nextCursor, planChanges, planSlackUpdate, slackChannelFor, slackNotice, usableMessages, type SlackAi, type SlackMessage } from "./slackLogic";
import { logError } from "./sysLog";
import { sendToOwnerWithButtons } from "./telegram";
import { putToken } from "./tgFlow";

// 每個專案一個 Slack 頻道（#progress-myapp、#progress-blog…）。各專案的 Claude 做完事會把進度貼到頻道，
// ideabox 每 5 分鐘（跟產品監控一起）讀新訊息，AI 整理後更新專案並用 Telegram 通知。
// 沒設定 SLACK_BOT_TOKEN 就整個略過。

const CURSOR = "slack_ts:";
const FIRST_LOOKBACK_SEC = 2 * 86_400; // 第一次讀頻道時往回看 2 天

type SlackResp<T> = T & { ok: boolean; error?: string };

async function slack<T>(method: string, params: Record<string, string>, post = false): Promise<SlackResp<T>> {
  const token = env.slackBotToken();
  // 從 Slack 頁面複製到遮住的「••••」而不是真的權杖時，給看得懂的錯誤
  if (!/^xox[a-z]-[A-Za-z0-9-]+$/.test(token)) throw new Error("SLACK_BOT_TOKEN 格式不對（應該是 xoxb- 開頭的英數字），請到 Slack 的 OAuth & Permissions 按 Copy 重新複製");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}${post ? "" : `?${qs}`}`, {
    method: post ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: post ? qs : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as SlackResp<T>;
  if (!json.ok) throw new Error(`Slack ${method}：${json.error ?? "unknown"}`);
  return json;
}

type Channel = { id: string; name: string; is_member?: boolean; is_private?: boolean };

/** 連線狀態（設定頁、專案頁用）：沒設定回傳 null */
export async function slackStatus(): Promise<{ ok: boolean; team?: string; error?: string } | null> {
  if (!env.slackBotToken()) return null;
  try {
    const r = await slack<{ team?: string }>("auth.test", {});
    return { ok: true, team: r.team };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function readCursor(channelId: string): Promise<string | null> {
  const { data } = await db().from("settings").select("value").eq("key", CURSOR + channelId).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}
async function saveCursor(channelId: string, ts: string) {
  await db().from("settings").upsert({ key: CURSOR + channelId, value: ts, updated_at: new Date().toISOString() });
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    log: { type: "string", description: "一句話總結這幾則回報做了什麼（繁中，60 字內）" },
    next_step: { type: "string", description: "回報裡寫到的下一步（繁中，60 字內）；沒提到就留空字串" },
    stage: { type: "string", description: "回報明確說進到哪個階段時，填階段清單中的名稱；沒提到就留空字串" },
    milestones: {
      type: "array",
      description: "回報裡有明確日期的目標（例如上線日、截止日）；沒有就空陣列",
      items: {
        type: "object",
        properties: { title: { type: "string", description: "20 字內" }, due: { type: "string", description: "YYYY-MM-DD" } },
        required: ["title", "due"],
      },
    },
    events: {
      type: "array",
      description: "回報裡【排程】或寫明日期區間要做的事（例如 11/20～11/25 封測第二輪）；單日的 start=end；沒有就空陣列。里程碑（單一截止點）放 milestones，不要重複放這裡",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "20 字內" },
          start: { type: "string", description: "YYYY-MM-DD" },
          end: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  required: ["log", "next_step", "stage", "milestones", "events"],
};

async function readReport(p: Project, msgs: SlackMessage[], today: string): Promise<SlackAi> {
  const text = msgs.map((m) => m.text!.trim()).join("\n---\n").slice(0, 8000);
  return callStructured<SlackAi>({
    model: env.analyzeModel(),
    system: [
      "你幫創業家把各專案貼到 Slack 的進度回報整理成專案狀態。只根據回報內容，不要猜。所有輸出用繁體中文。",
      `今天是 ${today}（台北時間）。`,
      `專案：${p.name}`,
      `階段清單：${p.stages.join("、")}；目前在「${p.stages[p.stage] ?? ""}」`,
      `目前的下一步：${p.next_step ?? "（還沒寫）"}`,
      "【排程】這類有日期區間的工作放 events；月日沒寫年份就用今天往後最接近的那一年。",
      "有好幾則時以最新的為準。回報裡的密碼、金鑰、權杖一律不要寫進輸出。",
    ].join("\n"),
    content: text,
    toolName: "save_project_update",
    toolDescription: "儲存從 Slack 回報整理出的專案狀態",
    schema: AI_SCHEMA,
    maxTokens: 600,
    purpose: "slack_progress",
  });
}

/** 讀所有專案頻道的新訊息並更新專案。回傳處理了幾個專案、幾則訊息 */
export type SlackSyncResult = { skipped?: boolean; projects: number; messages: number; missing?: string[]; errors?: string[] };

export async function runSlackSync(now = Date.now()): Promise<SlackSyncResult> {
  if (!env.slackBotToken()) return { skipped: true, projects: 0, messages: 0 };
  const { projects, ready } = await listProjects();
  if (!ready || !projects.length) return { projects: 0, messages: 0 };

  const self = await slack<{ user_id?: string }>("auth.test", {});
  const list = await slack<{ channels: Channel[] }>("conversations.list", {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: "500",
  });
  const byName = new Map(list.channels.map((c) => [c.name.toLowerCase(), c]));
  const today = taipeiDate(new Date(now));
  let touched = 0;
  let total = 0;
  let milestones: Milestone[] | null = null;
  let events: { project_id: string; title: string; start_date: string }[] | null = null;

  const missing: string[] = [];
  const errors: string[] = [];
  for (const p of projects) {
    const ch = byName.get(slackChannelFor(p));
    if (!ch) {
      if (p.status !== "done") missing.push(slackChannelFor(p));
      continue;
    }
    try {
      // 公開頻道 Bot 自己加入；私人頻道要你在頻道裡邀請它
      // 私人頻道只有 Bot 已經被邀請進去才會出現在清單裡，所以不用再判斷
      if (!ch.is_private && !ch.is_member) {
        await slack("conversations.join", { channel: ch.id }, true);
      }
      const cursor = (await readCursor(ch.id)) ?? String(Math.floor(now / 1000) - FIRST_LOOKBACK_SEC);
      const hist = await slack<{ messages: SlackMessage[] }>("conversations.history", { channel: ch.id, oldest: cursor, limit: "50" });
      const msgs = usableMessages(hist.messages ?? [], self.user_id);
      const newCursor = nextCursor(hist.messages ?? [], cursor);
      if (!msgs.length) {
        if (newCursor !== cursor) await saveCursor(ch.id, newCursor);
        continue;
      }

      if (!milestones) {
        const { data } = await db().from("project_milestones").select("*");
        milestones = (data ?? []) as Milestone[];
      }
      if (!events) {
        // 還沒執行 migration-015 時當作沒有排程
        const { data, error } = await db().from("project_events").select("project_id, title, start_date");
        events = error ? [] : ((data ?? []) as { project_id: string; title: string; start_date: string }[]);
      }
      const ai = await readReport(p, msgs, today);
      const plan = planSlackUpdate(p, ai, today, milestones, events);

      // 先記日誌，再改下一步／階段（updateProject 會自動再記一筆改了什麼）
      if (plan.log) await logActivity(p.id, plan.log, "slack");
      if (Object.keys(plan.patch).length) await updateProject(p, plan.patch, "slack");
      const added: string[] = [];
      for (const m of plan.milestones) {
        await addMilestone(p.id, m.title, m.due, "slack");
        const { data } = await db().from("project_milestones").select("id").eq("project_id", p.id).eq("title", m.title).eq("due", m.due).limit(1);
        const id = (data as { id: string }[] | null)?.[0]?.id;
        if (id) added.push(id);
        milestones.push({ id: id ?? "", project_id: p.id, title: m.title, due: m.due, done: false, reminded_7: false, reminded_1: false });
      }
      const addedEv: string[] = [];
      for (const e of plan.events) {
        const id = await addEvent(p.id, e.title, e.start, e.end, "slack").catch(() => null);
        if (id) addedEv.push(id);
        events.push({ project_id: p.id, title: e.title, start_date: e.start });
      }
      await saveCursor(ch.id, newCursor);

      if (planChanges(plan)) {
        const token = await putToken({ undo: p.id, stage: p.stage, next: p.next_step, ms: added, ev: addedEv });
        await sendToOwnerWithButtons(slackNotice(p, plan), [[{ text: "↩️ 改回來", data: `pu:${token}` }]]);
      }
      touched++;
      total += msgs.length;
    } catch (err) {
      // 一個頻道出錯不影響其他專案；沒存進度，下次會再讀一次
      errors.push(`#${ch.name}：${err instanceof Error ? err.message : String(err)}`.slice(0, 160));
      await logError("slack", err);
    }
  }
  if (errors.length && !touched) throw new Error(errors.join("；"));
  return { projects: touched, messages: total, missing, errors };
}
