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

export type HomeData = { today: string; theme?: { theme: string; mode: string }; projects: AppProject[]; events: AppEvent[]; milestones: AppMilestone[]; monitor: MonitorItem[] };
export type CalendarData = { month: string; projects: { id: string; name: string }[]; events: AppEvent[]; milestones: AppMilestone[] };
export type ProjectData = {
  project: { id: string; slug: string; name: string; status: AppProject["status"]; stages: string[]; stage_index: number; next_step: string | null; description: string | null; links: Record<string, string>; last_activity_at: string };
  milestones: AppMilestone[];
  logs: { id: number; at: string; source: string; text: string }[];
  events: AppEvent[];
};
export type Idea = { id: string; title: string; category: string | null; score: number | null; next_step: string | null; adopted: boolean; url: string | null; created_at: string; project: string | null };
export type IdeasData = { ideas: Idea[] };

export type OfficeStatus = "idle" | "working" | "waiting" | "permission" | "ended";
export type OfficePerson = { key: string; room: string; role: string | null; status: OfficeStatus; task: string | null; folder: string | null; sessions: number; updated_at: string };
export type OfficeData = { ready: boolean; now: number; projects: { id: string }[]; rooms: { id: string; name: string; stage: string | null }[]; people: OfficePerson[] };
