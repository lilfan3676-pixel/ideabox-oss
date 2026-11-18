// 辦公室規則（純函式，方便測試）：Claude Code 回報的事件 → 小人的狀態
import type { Project } from "./projectLogic";

export type AgentStatus = "idle" | "working" | "waiting" | "permission" | "ended";

export type AgentSession = {
  session_id: string;
  project_id: string | null;
  folder: string | null;
  role: string | null;
  /** 你手動選過職位（migration-018），AI 不再改 */
  role_locked?: boolean;
  task: string | null;
  status: AgentStatus;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  /** 桌面 App 給這個工作階段的編號（local_…，migration-024），用來對「誰把工作交給誰」 */
  host_id?: string | null;
};

/** AI 只能從這些職位裡挑（小人的衣服顏色跟著職位） */
export const ROLES = [
  "前端工程師",
  "後端工程師",
  "資料庫工程師",
  "App 工程師",
  "設計師",
  "文案企劃",
  "測試工程師",
  "維運工程師",
  "產品經理",
  "研究員",
  "法律顧問",
  "財務會計",
  "行銷社群",
  "業務營運",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_EN: Record<Role, string> = {
  前端工程師: "Frontend engineer",
  後端工程師: "Backend engineer",
  資料庫工程師: "Database engineer",
  "App 工程師": "App engineer",
  設計師: "Designer",
  文案企劃: "Copywriter",
  測試工程師: "QA engineer",
  維運工程師: "DevOps engineer",
  產品經理: "Product manager",
  研究員: "Researcher",
  法律顧問: "Legal advisor",
  財務會計: "Finance",
  行銷社群: "Marketing",
  業務營運: "Operations",
};

export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** 交給 AI 之前先把看起來像金鑰、權杖、密碼的東西遮掉 */
export function maskSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, "［金鑰］")
    .replace(/\bxox[a-z]-[A-Za-z0-9-]{10,}/g, "［金鑰］")
    .replace(/\b(gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}/g, "［金鑰］")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "［權杖］")
    .replace(/((?:password|passwd|secret|token|api[_-]?key|密碼|金鑰|權杖)\s*[:=：]\s*)\S+/gi, "$1［遮蔽］")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "［遮蔽］")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "［遮蔽］");
}

/** 依工作資料夾對應專案：路徑裡任何一層的名稱等於專案的「資料夾名稱」（不分大小寫），越深層越優先 */
export function matchProject(cwd: string, projects: Pick<Project, "id" | "folder" | "status">[]): string | null {
  const parts = String(cwd ?? "").split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = projects.find((x) => x.folder && x.folder.trim().toLowerCase() === parts[i]);
    if (p) return p.id;
  }
  return null;
}

/** 大廳的泡泡顯示用：工作資料夾的名稱（worktree 會往上找到真正的專案資料夾） */
export function folderName(cwd: string): string {
  const parts = String(cwd ?? "").split(/[\\/]+/).filter(Boolean);
  const wt = parts.lastIndexOf("worktrees");
  const base = wt > 1 && parts[wt - 1] === ".claude" ? parts[wt - 2] : parts.at(-1);
  return (base ?? "").slice(0, 40);
}

export type HookPayload = {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  message?: string;
  notification_type?: string;
  tool_name?: string;
  tool_input?: { title?: unknown } & Record<string, unknown>;
  tool_response?: unknown;
};

/** Claude Code 的事件 → 小人狀態；null = 不改狀態 */
export function statusFor(p: HookPayload): AgentStatus | null {
  switch (p.hook_event_name) {
    case "SessionStart":
      return "idle";
    case "UserPromptSubmit":
    case "PostToolUse": // 心跳：Claude 每用完一個工具（腳本限制最多每分鐘一次）就代表還在工作
      return "working";
    case "Stop":
      return "waiting";
    case "SessionEnd":
      return "ended";
    case "Notification": {
      const t = `${p.notification_type ?? ""} ${p.message ?? ""}`.toLowerCase();
      if (/permission|approv|允許|權限/.test(t)) return "permission";
      if (/idle|waiting for your input/.test(t)) return "waiting";
      return null;
    }
    default:
      return null;
  }
}

/** 已經下班的不再被心跳、通知叫回來（只有重新交代事情或重新開工才算） */
export function revives(p: HookPayload): boolean {
  return p.hook_event_name === "UserPromptSubmit" || p.hook_event_name === "SessionStart";
}

/** 「好」「繼續」這種短回覆不重新判斷在做什麼 */
export const worthSummarizing = (prompt: string) => prompt.replace(/\s+/g, "").length >= 6;

const MIN = 60_000;
const HOUR = 60 * MIN;
export const KEEP_DAYS = 7; // 7 天內上過班的都留在辦公室（下班的在房間裡走動），每日排程會清掉更舊的
export const WORKING_STALE_MIN = 10; // 「工作中」超過 10 分鐘沒有心跳，多半是被中斷了（按 Esc 不會回報），顯示成休息中
export const OFF_DUTY_MIN = 30; // 不管什麼狀態，超過 30 分鐘沒動靜就當作下班

export function visibleSessions(list: AgentSession[], now: number): AgentSession[] {
  return list
    .filter((s) => now - Date.parse(s.updated_at) < KEEP_DAYS * 24 * HOUR)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** 畫面上的狀態：關掉了、或太久沒回應 = 下班；工作中但很久沒心跳 = 休息中 */
export function displayStatus(s: Pick<AgentSession, "status" | "updated_at">, now: number): AgentStatus {
  if (s.status === "ended") return "ended";
  const age = now - Date.parse(s.updated_at);
  if (age > OFF_DUTY_MIN * MIN) return "ended";
  if (s.status === "working" && age > WORKING_STALE_MIN * MIN) return "idle";
  return s.status;
}

/** 上班中（坐在位子上）＝ 還沒下班的 */
export const onDuty = (s: Pick<AgentSession, "status" | "updated_at">, now: number) => displayStatus(s, now) !== "ended";

/** 辦公室裡的「人」：同一個專案、同一個職位就是同一個人（長相固定）。
 *  哪個 Claude 在做這個職位的事，就是這個人在工作；都沒在做就是待機，在房間裡走動。 */
export type Staff = AgentSession & { sessions: number };

const RANK: Record<AgentStatus, number> = { working: 0, permission: 1, waiting: 2, idle: 3, ended: 4 };

export function staffOf(list: AgentSession[], now: number): Staff[] {
  const groups = new Map<string, AgentSession[]>();
  for (const s of list) {
    const key = staffKey(s);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].map(([key, g]) => {
    // 代表的那個 Claude：最忙的優先，一樣忙就看最近有動靜的
    const rep = [...g].sort((a, b) => RANK[displayStatus(a, now)] - RANK[displayStatus(b, now)] || b.updated_at.localeCompare(a.updated_at))[0];
    return {
      ...rep,
      session_id: key,
      started_at: g.reduce((m, s) => (s.started_at < m ? s.started_at : m), rep.started_at),
      sessions: g.filter((s) => onDuty(s, now)).length,
    };
  }).sort((a, b) => a.started_at.localeCompare(b.started_at));
}

// ---------- 交接：一個 Claude 開了新的工作階段，把工作交給它 ----------

/** 交接紀錄（migration-024）。to = 接手那個工作階段的 session_id（還沒回報過就是 null） */
export type Handoff = { id: string; from: string; to: string | null; title: string | null; created_at: string };

const HOST_RE = /^local_[A-Za-z0-9_-]{4,80}$/;
/** 桌面 App 的工作階段編號長這樣：local_…；其他的不收 */
export const cleanHostId = (v: unknown): string | null => (typeof v === "string" && HOST_RE.test(v.trim()) ? v.trim() : null);

/** 桌面 App 開新工作階段的工具（start_session、hand_off_to_session） */
export const isHandoffTool = (name: unknown) => typeof name === "string" && /(^|__)ccd_session__(start_session|hand_off_to_session)$/.test(name);

/** 從工具回傳的內容裡找出新工作階段的編號（local_…），扣掉自己，最多 4 個 */
export function handoffTargets(resp: unknown, own: string | null): string[] {
  let text = "";
  try {
    text = typeof resp === "string" ? resp : JSON.stringify(resp ?? "");
  } catch {
    return [];
  }
  const ids = [...new Set(text.match(/local_[A-Za-z0-9_-]{4,80}/g) ?? [])].filter((x) => x !== own);
  return ids.slice(0, 4);
}

/** 辦公室裡「人」的代號：同專案同職位＝同一個人（跟 staffOf 一樣） */
export const staffKey = (s: Pick<AgentSession, "project_id" | "role">) => `${s.project_id ?? "lobby"}:${s.role ?? "新人"}`;

/** 接手的人還在做（工作中、等你回覆、等你同意）＝ 畫連線 */
export const handoffLive = (to: Pick<AgentSession, "status" | "updated_at"> | undefined, now: number) =>
  !!to && ["working", "waiting", "permission"].includes(displayStatus(to, now));

/** 辦公室最上面那排數字：現在幾個在工作、幾個在等你、幾個休息中、今天（台北時間）交接幾次 */
export function officeCounts(sessions: Pick<AgentSession, "status" | "updated_at">[], handoffs: Pick<Handoff, "created_at">[], now: number): { working: number; needYou: number; idle: number; off: number; handoffsToday: number } {
  const st = sessions.map((s) => displayStatus(s, now));
  const day = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10); // 台北沒有日光節約時間
  return {
    working: st.filter((x) => x === "working").length,
    needYou: st.filter((x) => x === "waiting" || x === "permission").length,
    idle: st.filter((x) => x === "idle").length,
    off: st.filter((x) => x === "ended").length,
    handoffsToday: handoffs.filter((h) => day(Date.parse(h.created_at)) === day(now)).length,
  };
}
