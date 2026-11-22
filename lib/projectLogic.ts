// 專案管理規則（純函式，前後端共用、方便測試）
import { parseTime } from "./appTime";
import { parsePostCommand, type PostCommand } from "./postLogic";
import { daysBetween, isIsoDate } from "./dates";

export type ProjectStatus = "active" | "paused" | "done";

export type Project = {
  id: string;
  slug: string;
  name: string;
  stages: string[];
  stage: number;
  next_step: string | null;
  status: ProjectStatus;
  folder: string | null;
  repo: string | null;
  description?: string | null; // 一句話描述，AI 分析點子時參考（migration-013）
  slack_channel?: string | null; // Slack 頻道名稱，空的就用短名（migration-013）
  links?: ProjectLinks; // 官網與社群連結（migration-016）
  radar_keywords?: string[]; // 話題雷達要追的關鍵字（migration-021）
  sort: number;
  last_activity_at: string;
  stale_asked_at: string | null;
  created_at?: string;
};

/** 待辦（資料表與程式沿用舊名 milestone）：日期可以不填（migration-036），沒日期的不上月曆、不提醒 */
export type Milestone = {
  id: string;
  project_id: string;
  title: string;
  due: string | null; // YYYY-MM-DD；沒填＝沒有期限
  done: boolean;
  reminded_7: boolean;
  reminded_1: boolean;
};

/** 排程：有實際日期的工作（月曆上顯示）；單日的事情 end_date = start_date */
export type ProjectEvent = { id: string; project_id: string; title: string; start_date: string; end_date: string; start_time?: string | null; source: "manual" | "telegram" | "slack" }; // start_time：台北時間 HH:MM:SS（migration-022，選填）

export type LogSource = "manual" | "telegram" | "claude" | "github" | "slack" | "system";
export type ProjectLog = { id: number; project_id: string; at: string; source: LogSource; text: string };

/** 專案的快捷連結（順序就是顯示順序） */
export const LINK_KINDS = ["website", "instagram", "threads", "facebook", "line", "youtube", "app"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export type ProjectLinks = Partial<Record<LinkKind, string>>;
export const LINK_LABEL: Record<LinkKind, [string, string]> = {
  website: ["官網", "Website"],
  instagram: ["Instagram", "Instagram"],
  threads: ["Threads", "Threads"],
  facebook: ["Facebook", "Facebook"],
  line: ["LINE 官方帳號", "LINE"],
  youtube: ["YouTube", "YouTube"],
  app: ["App 下載", "App"],
};

/** 整理連結：沒寫 https:// 就補上，不是網址的拿掉；回傳錯誤的欄位 */
export function cleanLinks(v: Record<string, unknown>): { links: ProjectLinks; bad: LinkKind[] } {
  const links: ProjectLinks = {};
  const bad: LinkKind[] = [];
  for (const k of LINK_KINDS) {
    const raw = String(v?.[k] ?? "").trim();
    if (!raw) continue;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw new Error("bad");
      links[k] = u.toString().slice(0, 300);
    } catch {
      bad.push(k);
    }
  }
  return { links, bad };
}

export const STALE_DAYS = 5;
export const STAGES_MAX = 12;
const DAY = 86_400_000;

/** 階段：可以用逗號、頓號或換行分隔；去掉空的與重複的 */
export function cleanStages(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,，、\n→>]+/);
  const out: string[] = [];
  for (const p of parts) {
    const s = p.replace(/\s+/g, " ").trim().slice(0, 20);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.slice(0, STAGES_MAX);
}

/** 專案短名（Telegram 指令用）：英數小寫與連字號 */
export function cleanSlug(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
}

export const clampStage = (stage: number, stages: string[]) => Math.max(0, Math.min(Math.floor(stage) || 0, Math.max(0, stages.length - 1)));

/** 日期：2026-12-01、2026/12/1、12/1（今天以前的月日算明年） */
export function parseDue(s: string, today: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return isIsoDate(d) ? d : null;
  }
  m = t.match(/^(\d{1,2})[/.月](\d{1,2})日?$/);
  if (!m) return null;
  const y = +today.slice(0, 4);
  let d = `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (!isIsoDate(d)) return null;
  if (d < today) d = `${y + 1}${d.slice(4)}`;
  return isIsoDate(d) ? d : null;
}

/** 排程日期：月日沒寫年份時，60 天內的過去日期算今年（可能是補記），更早的算明年 */
function parseDay(t: string, today: string, defaultYear?: number): string | null {
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return isIsoDate(d) ? d : null;
  }
  m = t.match(/^(\d{1,2})[/.月](\d{1,2})日?$/);
  if (!m) return null;
  const y = defaultYear ?? +today.slice(0, 4);
  let d = `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if (!isIsoDate(d)) return null;
  if (defaultYear === undefined && daysBetween(d, today) > 60) d = `${y + 1}${d.slice(4)}`;
  return isIsoDate(d) ? d : null;
}

/** 「11/20-11/25」「11/20～25」「12/28 到 1/3」「2026/12/1」「12/1」→ 開始、結束日期 */
export function parseRange(s: string, today: string): { start: string; end: string } | null {
  const parts = s.trim().split(/\s*(?:-|－|~|～|〜|到|至)\s*/);
  if (parts.length === 1) {
    const d = parseDay(parts[0], today);
    return d ? { start: d, end: d } : null;
  }
  if (parts.length !== 2) return null;
  const start = parseDay(parts[0], today);
  if (!start) return null;
  // 結束只寫日（11/20-25）就沿用開始的月份
  const endText = /^\d{1,2}日?$/.test(parts[1]) ? `${+start.slice(5, 7)}/${parts[1].replace("日", "")}` : parts[1];
  let end = parseDay(endText, today, +start.slice(0, 4));
  if (!end) return null;
  if (end < start) {
    // 跨年（12/28-1/3）才往明年算；跨太久多半是打錯（11/25-11/20）
    end = parseDay(endText, today, +start.slice(0, 4) + 1);
    if (end && daysBetween(start, end) > 62) return null;
  }
  if (!end || end < start || daysBetween(start, end) > 366) return null;
  return { start, end };
}

/** 有日期的待辦（月曆、時程表、時間軸只畫這種） */
export type DatedMilestone = Milestone & { due: string };
export const withDate = (ms: Milestone[]): DatedMilestone[] => ms.filter((m): m is DatedMilestone => !!m.due);

/** 有日期、還沒做完的待辦，照日期由近到遠（沒日期的不算） */
export const datedOpen = <T extends Pick<Milestone, "due" | "done">>(ms: T[]): (T & { due: string })[] =>
  ms.filter((m): m is T & { due: string } => !m.done && !!m.due).sort((a, b) => a.due.localeCompare(b.due));

/** 待辦提醒：前 7 天、前 1 天各一次（錯過 7 天那次、直接進 1 天內就只提醒 1 天那次） */
export function milestoneReminder(today: string, m: Pick<Milestone, "due" | "done" | "reminded_7" | "reminded_1">): "7" | "1" | null {
  if (m.done || !m.due) return null;
  const days = daysBetween(today, m.due);
  if (days < 0) return null;
  if (days <= 1) return m.reminded_1 ? null : "1";
  if (days <= 7) return m.reminded_7 ? null : "7";
  return null;
}

/** 久沒動：進行中、超過 5 天沒更新，而且 5 天內沒問過 */
export function isStale(p: Pick<Project, "status" | "last_activity_at" | "stale_asked_at">, now: number): boolean {
  if (p.status !== "active") return false;
  if (now - Date.parse(p.last_activity_at) < STALE_DAYS * DAY) return false;
  return !p.stale_asked_at || now - Date.parse(p.stale_asked_at) >= STALE_DAYS * DAY;
}

export const daysIdle = (p: Pick<Project, "last_activity_at">, now: number) => Math.floor((now - Date.parse(p.last_activity_at)) / DAY);

export const stageName = (p: Pick<Project, "stages" | "stage">) => p.stages[clampStage(p.stage, p.stages)] ?? "";

// ---------- Telegram 文字指令 ----------

export type ProjectCommand =
  | { project: Project; action: "next"; value: string }
  | { project: Project; action: "stage"; value: number }
  | { project: Project; action: "log"; value: string }
  | { project: Project; action: "milestone"; value: string; due: string | null }
  | { project: Project; action: "event"; value: string; start: string; end: string; time: string | null }
  | { project: Project; action: "post"; value: PostCommand }
  | { project: Project; action: "sprint"; value: string; due: string; time: string | null }
  | { project: Project; action: "sprintOff" }
  | { project: Project; action: "error"; value: string };

const ACTIONS: Record<string, "next" | "stage" | "advance" | "log" | "milestone" | "event" | "post" | "sprint"> = {
  衝刺: "sprint",
  排程: "event",
  發文: "post",
  下一步: "next",
  階段: "stage",
  下一階段: "advance",
  進下一階段: "advance",
  記錄: "log",
  紀錄: "log",
  日誌: "log",
  里程碑: "milestone",
  待辦: "milestone",
};

/**
 * 「app 下一步 做好友動態」「app 階段 上架審核」「app 下一階段」「app 記錄 修好地圖」「app 待辦 12/1 正式上架」「app 待辦 整理說明文件」（日期可以不寫；舊的「里程碑」也認得；app = 專案短名）
 * 「app 衝刺 11/30 12:00 報名截止」＝到那天之前每天早晚提醒今天該做什麼（lib/sprint.ts），「app 衝刺 取消」停止
 * 開頭不是專案名、或第二個詞不是指令就回傳 null（交給點子庫／其他存放地點分流）
 */
export function parseProjectCommand(text: string, projects: Project[], today: string): ProjectCommand | null {
  // 指令後面要接空白、冒號或直接結束：「app 下一階段很重要的功能」是點子，不是指令
  const m = text.trim().match(/^(\S+)\s+(下一步|進下一階段|下一階段|階段|記錄|紀錄|日誌|里程碑|待辦|排程|發文|衝刺)(?:[\s：:]+([\s\S]*))?$/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const project = projects.find((p) => p.slug === key || p.name.toLowerCase() === key);
  if (!project) return null;
  const action = ACTIONS[m[2]];
  const rest = (m[3] ?? "").trim();

  if (action === "advance") {
    if (project.stage >= project.stages.length - 1) return { project, action: "error", value: "已經是最後一個階段了" };
    return { project, action: "stage", value: project.stage + 1 };
  }
  if (action === "stage") {
    if (!rest) return { project, action: "error", value: `要到哪個階段？可選：${project.stages.join("、")}` };
    const n = /^\d+$/.test(rest) ? +rest - 1 : project.stages.findIndex((s) => s.toLowerCase() === rest.toLowerCase());
    if (n < 0 || n >= project.stages.length) return { project, action: "error", value: `找不到「${rest}」這個階段。可選：${project.stages.join("、")}` };
    return { project, action: "stage", value: n };
  }
  if (action === "milestone") {
    if (!rest) return { project, action: "error", value: "格式：待辦 12/1 正式上架（日期可以不寫：待辦 整理說明文件）" };
    // 第一個詞是日期就當期限，不是就整句都是待辦的內容
    const mm = rest.match(/^(\S+)\s+([\s\S]+)$/);
    const due = mm ? parseDue(mm[1], today) : null;
    return { project, action: "milestone", value: (due ? mm![2] : rest).trim().slice(0, 80), due };
  }
  if (action === "sprint") {
    if (/^(取消|停止|結束|關掉|完成)$/.test(rest)) return { project, action: "sprintOff" };
    // 「衝刺 11/30 報名截止」「衝刺 11/30 12:00 報名截止」：到那天之前每天提醒今天該做什麼
    const mm = rest.match(/^(\S+)(?:\s+(\d{1,2}[:：]\d{2}))?(?:\s+([\s\S]+))?$/);
    const due = mm ? parseDue(mm[1], today) : null;
    if (!due) return { project, action: "error", value: `格式：衝刺 11/30 12:00 報名截止（時間可以不寫）；停止：${project.slug} 衝刺 取消` };
    return { project, action: "sprint", value: (mm![3] ?? "期限").trim().slice(0, 40), due, time: mm![2] ? parseTime(mm![2]) : null };
  }
  if (action === "post") {
    const cmd = parsePostCommand(rest, today);
    if (!cmd) return { project, action: "error", value: "格式：發文 11/21 20:00 中山社團 常見問題整理（時間可以不寫，預設 20:00）" };
    return { project, action: "post", value: cmd };
  }
  if (action === "event") {
    const mm = rest.match(/^(\S+(?:\s*(?:-|－|~|～|〜|到|至)\s*\S+)?)\s+([\s\S]+)$/);
    const r = mm ? parseRange(mm[1], today) : null;
    if (!mm || !r) return { project, action: "error", value: "格式：排程 11/20-11/25 封測第二輪（單日：排程 12/1 送審；要提醒：排程 12/1 14:00 開會）" };
    // 日期後面可以接時間：「排程 12/1 14:00 跟投資人開會」
    const tm = mm[2].trim().match(/^(\d{1,2}[:：]\d{2})\s+([\s\S]+)$/);
    const time = tm ? parseTime(tm[1]) : null;
    const title = (time ? tm![2] : mm[2]).trim().slice(0, 80);
    return { project, action: "event", value: title, start: r.start, end: r.end, time };
  }
  if (!rest) return { project, action: "error", value: action === "next" ? `下一步要做什麼？例如：${project.slug} 下一步 做好友動態` : "要記錄什麼？" };
  return { project, action, value: rest.slice(0, action === "log" ? 500 : 200) };
}

// ---------- 每日早上總覽 ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Digest = { html: string; remind7: string[]; remind1: string[]; staleAsked: string[] };

/** 早上 8 點的訊息：各專案做到哪、下一步、快到期的待辦、久沒動的專案 */
export function buildDigest(projects: Project[], milestones: Milestone[], today: string, now: number, appUrl?: string | null, extra: string[] = []): Digest {
  const remind7: string[] = [];
  const remind1: string[] = [];
  const staleAsked: string[] = [];
  const active = projects.filter((p) => p.status === "active");
  const lines: string[] = ["☀️ <b>早安，今天的專案進度</b>"];

  // 快到期的待辦放最上面
  const alerts: string[] = [];
  for (const m of datedOpen(milestones)) {
    const p = projects.find((x) => x.id === m.project_id);
    if (!p || p.status !== "active") continue; // 暫停、完成的專案不提醒
    const r = milestoneReminder(today, m);
    if (!r) continue;
    const days = daysBetween(today, m.due);
    (r === "1" ? remind1 : remind7).push(m.id);
    const when = days === 0 ? "就是今天" : days === 1 ? "明天" : `還有 ${days} 天`;
    alerts.push(`${r === "1" ? "🔴" : "🟡"} ${esc(p.name)}｜${esc(m.title)}（${m.due.slice(5).replace("-", "/")}，${when}）`);
  }
  if (alerts.length) lines.push("", "⏰ <b>待辦快到期</b>", ...alerts);

  for (const p of active) {
    const open = milestones.filter((m) => m.project_id === p.id && !m.done);
    const next = datedOpen(open).find((m) => m.due >= today);
    lines.push(
      "",
      `<b>${esc(p.name)}</b>・${esc(stageName(p))}（${clampStage(p.stage, p.stages) + 1}/${p.stages.length || 1}）`,
      `👉 ${p.next_step ? esc(p.next_step) : "還沒寫下一步"}`,
    );
    if (next) lines.push(`📅 ${esc(next.title)}：${next.due.slice(5).replace("-", "/")}（${daysBetween(today, next.due)} 天後）`);
    if (open.length > (next ? 1 : 0)) lines.push(`📋 待辦還有 ${open.length} 件`);
  }
  if (!active.length) lines.push("", "目前沒有進行中的專案。");

  const stale = active.filter((p) => isStale(p, now));
  if (stale.length) {
    lines.push("", "💤 <b>好久沒動了，還在做嗎？</b>");
    for (const p of stale) {
      staleAsked.push(p.id);
      lines.push(`・${esc(p.name)} 已經 ${daysIdle(p, now)} 天沒更新（不做了可以在專案頁按「暫停」）`);
    }
  }

  // 模組多放的幾行（例如產品的成長數字）
  for (const x of extra) lines.push("", x);

  const ex = esc(active[0]?.slug ?? projects[0]?.slug ?? "短名");
  lines.push("", `更新方式：回我「${ex} 下一步 ＿＿」「${ex} 下一階段」「${ex} 記錄 ＿＿」`);
  if (appUrl) lines.push(`${appUrl.replace(/\/+$/, "")}/projects`);
  return { html: lines.join("\n"), remind7, remind1, staleAsked };
}

// ---------- 詳細頁：階段歷程 ----------

export type StageSegment = { name: string; from: string; to: string; current: boolean; days: number };

/** 從工作日誌裡的「階段：A → B」還原每個階段待了多久（第一段從專案建立開始，最後一段到現在） */
export function stageSegments(p: Pick<Project, "stages" | "stage" | "created_at" | "last_activity_at">, logs: Pick<ProjectLog, "at" | "text">[], now: number): StageSegment[] {
  const changes = logs
    .map((l) => ({ at: l.at, m: l.text.match(/^階段：(.+?) → (.+)$/) }))
    .filter((c): c is { at: string; m: RegExpMatchArray } => !!c.m)
    .sort((a, b) => a.at.localeCompare(b.at));
  const start = p.created_at ?? changes[0]?.at ?? p.last_activity_at;
  const out: StageSegment[] = [];
  let name = changes[0]?.m[1] ?? stageName(p);
  let from = start;
  for (const c of changes) {
    if (c.at > from) out.push({ name, from, to: c.at, current: false, days: Math.max(0, Math.round((Date.parse(c.at) - Date.parse(from)) / DAY)) });
    name = c.m[2];
    from = c.at;
  }
  const end = new Date(now).toISOString();
  out.push({ name: stageName(p) || name, from, to: end, current: true, days: Math.max(0, Math.round((now - Date.parse(from)) / DAY)) });
  return out;
}
