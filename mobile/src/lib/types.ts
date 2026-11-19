// ideabox 的 /api/app/* 回傳格式（跟 ideabox/lib/app.ts 對應）

export type AppEvent = { id: string; project_id: string; title: string; start_date: string; end_date: string; start_time: string | null };
export type AppMilestone = { id: string; project_id: string; title: string; due: string; done: boolean };
export type AppProject = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "done";
  stage: string | null;
  stage_index: number;
  stage_count: number;
  next_step: string | null;
  last_activity_at: string;
};
export type MonitorItem = { service: string; product: string; label: string; ok: boolean; changed_at: string; error: string | null };

export type HomeData = { today: string; theme?: { theme: string; mode: string }; access?: { owner: boolean; name: string | null; tabs: string[]; can_edit: boolean }; projects: AppProject[]; events: AppEvent[]; milestones: AppMilestone[]; monitor: MonitorItem[] };
export type CalendarData = { month: string; projects: { id: string; name: string }[]; events: AppEvent[]; milestones: AppMilestone[] };
export type ProjectData = {
  project: { id: string; slug: string; name: string; status: AppProject["status"]; stages: string[]; stage_index: number; next_step: string | null; description: string | null; links: Record<string, string>; last_activity_at: string };
  milestones: AppMilestone[];
  logs: { id: number; at: string; source: string; text: string }[];
  events: AppEvent[];
};

export type OfficeStatus = "idle" | "working" | "waiting" | "permission" | "ended";
export type OfficePerson = { key: string; room: string; role: string | null; status: OfficeStatus; task: string | null; folder: string | null; sessions: number; updated_at: string };
export type OfficeData = { ready: boolean; now: number; projects: { id: string }[]; rooms: { id: string; name: string; stage: string | null }[]; people: OfficePerson[] };

// 監控分頁（/api/app/monitor）
export type MonitorService = { id: string; name: string; checked: boolean; ok: boolean | null; since: string | null; latency_ms: number | null; error: string | null };
export type MonitorDay = { day: string; users: number | null; active7: number | null; new7: number | null; db_bytes: number | null };
export type Breakdown = {
  title: string;
  note?: string;
  error?: string;
  views: { label: string; total: number; parts: { label: string; n: number; pct: number; color: string }[]; table?: { cols: string[]; rows: { label: string; cells: number[] }[] } }[];
};
export type MonitorProductData = { key: string; label: string; services: MonitorService[]; metrics: { users: string; active7: string; new7: string } | null; db_limit: number | null; db_label: string | null; hint: string | null; daily: MonitorDay[]; /** 舊版伺服器沒有 */ breakdowns?: Breakdown[] };
export type MonitorData = { ready: boolean; products: MonitorProductData[]; health: { at: string; issues: { level: "error" | "warn"; text: string }[]; days: number; errors: number; ai_usd_week: number } | null };
