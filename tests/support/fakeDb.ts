// 測試用的記憶體資料庫，模擬 supabase-js 查詢語法中本專案用到的部分。
import { randomUUID } from "node:crypto";
import { PRIVATE_DEFAULTS, PRIVATE_UNIQUE } from "./fakeDbPrivate";

type Row = Record<string, any>;
export const tables: Record<string, Row[]> = { ideas: [], grants: [], settings: [], monitor_status: [], monitor_daily: [], expenses: [], ai_usage: [], sys_events: [], feedback_signals: [], learned_rules: [], folders: [], projects: [], project_milestones: [], project_logs: [], agent_sessions: [], agent_handoffs: [], project_events: [], radar_reports: [], app_devices: [], members: [] };
for (const k of Object.keys(PRIVATE_UNIQUE)) tables[k] = [];

export const MAX_ROWS = 1000;
let seq = 0;
const DEFAULTS: Record<string, () => Row> = {
  ideas: () => ({
    id: randomUUID(), source: "threads", url: null, post_key: null, author: null, content: null, note: null,
    status: "pending", image_path: null, design: null, in_brief: false, folder_id: null, folder_locked: false, summary: null, category: null, tags: [], score_arx: null, score_feasibility: null,
    score_market: null, score_total: null, score_reason: null, next_step: null, adopted: false,
    telegram_message_id: null, telegram_file_id: null, analyze_attempts: 0, created_at: new Date().toISOString(), analyzed_at: null,
  }),
  grants: () => ({
    id: randomUUID(), status: "new", reminded_14: false, reminded_3: false, created_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }),
  settings: () => ({}),
  folders: () => ({ id: randomUUID(), sort: 0, category: null, created_at: new Date().toISOString() }),
  projects: () => ({ id: randomUUID(), stages: [], stage: 0, next_step: null, status: "active", folder: null, repo: null, sort: 0, last_activity_at: new Date().toISOString(), stale_asked_at: null, created_at: new Date().toISOString() }),
  agent_sessions: () => ({ project_id: null, folder: null, role: null, task: null, status: "idle", started_at: new Date().toISOString(), updated_at: new Date().toISOString(), ended_at: null }),
  agent_handoffs: () => ({ id: randomUUID(), title: null, created_at: new Date().toISOString() }),
  project_events: () => ({ id: randomUUID(), source: "manual", start_time: null, reminded: false, created_at: new Date().toISOString() }),
  app_devices: () => ({ id: randomUUID(), name: "手機", push_token: null, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }),
  members: () => ({ id: randomUUID(), project_ids: [], pages: [], can_edit: false, push: true, active: true, user_id: null, invite_hash: null, invite_exp: null, last_login_at: null, created_at: new Date().toISOString() }),
  radar_reports: () => ({ id: randomUUID(), status: "running", keywords: [], post_count: 0, summary: null, idea_ids: [], error: null, finished_at: null, created_at: new Date().toISOString() }),
  project_milestones: () => ({ id: randomUUID(), done: false, reminded_7: false, reminded_1: false, created_at: new Date().toISOString() }),
  project_logs: () => ({ id: ++seq, at: new Date().toISOString(), source: "manual" }),
  monitor_status: () => ({}),
  monitor_daily: () => ({}),
  expenses: () => ({ id: randomUUID(), note: null, active: true, reminded_for: null, created_at: new Date().toISOString() }),
  ai_usage: () => ({ at: new Date().toISOString() }),
  sys_events: () => ({ id: ++seq, at: new Date().toISOString(), ok: true, detail: null, ms: null }),
  feedback_signals: () => ({ id: ++seq, at: new Date().toISOString(), ref_id: null, snapshot: {}, learned: false }),
  learned_rules: () => ({ id: ++seq, evidence: 1, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  ...PRIVATE_DEFAULTS,
};
const UNIQUE: Record<string, string[]> = { ideas: ["post_key"], grants: ["dedupe_key"], settings: ["key"], monitor_status: ["service"], monitor_daily: ["product+day"], expenses: ["id"], ai_usage: [], sys_events: [], feedback_signals: [], learned_rules: [], folders: [], projects: ["slug"], project_milestones: [], project_logs: [], agent_sessions: ["session_id"], agent_handoffs: ["from_session+to_host"], project_events: [], radar_reports: [], app_devices: ["token_hash"], members: ["email"], ...PRIVATE_UNIQUE };
// 「a+b」代表複合唯一鍵
// 複合鍵有任一欄是 null 時不算重複（跟 Postgres 一樣）
const keyOf = (r: Row, u: string) => {
  if (!u.includes("+")) return r[u];
  const parts = u.split("+").map((c) => r[c]);
  return parts.some((x) => x == null) ? null : parts.join("|");
};

export function reset() {
  for (const k of Object.keys(tables)) tables[k] = [];
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private orders: Array<[string, boolean, boolean]> = [];
  private lim = Infinity;
  private mode: "many" | "single" | "maybe" = "many";
  private countHead = false;
  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.countHead = true;
    return this;
  }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row | Row[], _o?: unknown) { this.op = "upsert"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  like(c: string, pattern: string) {
    const re = new RegExp("^" + pattern.split("%").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    this.filters.push((r) => typeof r[c] === "string" && re.test(r[c]));
    return this;
  }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] <= v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] !== null && r[c] < v); return this; }
  or(_s: string) { return this; }
  not(c: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => r[c] !== v);
    if (op === "in" && typeof v === "string") {
      const list = v.replace(/[()]/g, "").split(",");
      this.filters.push((r) => r[c] !== null && !list.includes(r[c]));
    }
    return this;
  }
  order(c: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push([c, o.ascending ?? true, o.nullsFirst ?? false]);
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  private skip = 0;
  range(from: number, to: number) { this.skip = from; this.lim = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then(resolve: (v: any) => void, reject: (e: any) => void) {
    try { resolve(this.run()); } catch (e) { reject(e); }
  }

  private run() {
    const t = tables[this.table];
    let rows: Row[] = [];
    if (this.op === "insert" || this.op === "upsert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const item of items) {
        const dup = UNIQUE[this.table].find((u) => keyOf(item, u) != null && t.some((r) => keyOf(r, u) === keyOf(item, u)));
        if (dup) {
          if (this.op === "upsert") {
            const ex = t.find((r) => keyOf(r, dup) === keyOf(item, dup))!;
            Object.assign(ex, item);
            rows.push(ex);
            continue;
          }
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        const row = { ...DEFAULTS[this.table](), ...item };
        t.push(row);
        rows.push(row);
      }
    } else {
      rows = t.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") rows.forEach((r) => Object.assign(r, this.payload));
      if (this.op === "delete") tables[this.table] = t.filter((r) => !rows.includes(r));
    }
    for (const [c, asc, nullsFirst] of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        if (a[c] === b[c]) return 0;
        if (a[c] === null) return nullsFirst ? -1 : 1;
        if (b[c] === null) return nullsFirst ? 1 : -1;
        return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    // 跟正式環境的 Supabase（PostgREST max-rows）一樣：一次查詢最多回 1000 筆，limit 再大也一樣
    if (this.countHead) return { data: null, count: rows.length, error: null }; // count 不受 1000 筆限制
    rows = rows.slice(this.skip, this.skip + Math.min(this.lim, MAX_ROWS)).map((r) => ({ ...r }));
    if (this.mode === "single") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not single" } };
    if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}

export const stored: Record<string, Buffer> = {};
const storage = {
  from: () => ({
    upload: async (path: string, body: Buffer) => { stored[path] = body; return { data: { path }, error: null }; },
    download: async (path: string) =>
      stored[path] ? { data: new Blob([new Uint8Array(stored[path])]), error: null } : { data: null, error: { message: "not found" } },
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })), error: null }),
    remove: async (paths: string[]) => { paths.forEach((p) => delete stored[p]); return { data: null, error: null }; },
  }),
};

export const fakeDb = { from: (t: string) => new Query(t), storage };
