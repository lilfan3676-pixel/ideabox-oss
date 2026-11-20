import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// 伺服器專用（service role），可略過 RLS。絕對不要在瀏覽器端 import。
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export { CATEGORY_LABEL, DESIGN_CATEGORIES, isDesign, type Category } from "./labels";
import type { Category } from "./labels";

export type Idea = {
  id: string;
  source: "threads" | "text" | "photo" | "link";
  url: string | null;
  post_key: string | null;
  author: string | null;
  content: string | null;
  note: string | null;
  status: "pending" | "needs_input" | "analyzed" | "failed";
  summary: string | null;
  category: Category | null;
  tags: string[];
  score_arx: number | null;
  score_feasibility: number | null;
  score_market: number | null;
  score_total: number | null;
  score_reason: string | null;
  next_step: string | null;
  adopted: boolean;
  telegram_message_id: number | null;
  telegram_file_id: string | null;
  image_path: string | null;
  design: DesignInfo | null;
  in_brief: boolean;
  folder_id: string | null;
  folder_locked: boolean; // 手動搬過的資料夾，AI 重新分析時不再自動改
  project_id?: string | null; // 這則點子給哪個專案（migration-013；空的 = 沒指定）
  analyze_attempts: number;
  dup_of?: string | null; // 可能跟哪一則重複（AI 判斷，migration-019）
  dup_dismissed?: boolean; // 按過「不是重複」就不再比對
  scoring?: import("./scoring").Scoring | null; // 第 2 版評分：評分角度＋每個專案的適用度（migration-033；空的 = 舊算法評的）
  created_at: string;
  analyzed_at: string | null;
};

export type GithubInfo = {
  repo: string;
  description?: string | null;
  stars?: number;
  language?: string | null;
  license?: string | null;
  pushed_at?: string | null;
  topics?: string[];
  homepage?: string | null;
};

export type DesignInfo = {
  styles?: string[];
  learn?: string[];
  apply?: string;
  github?: GithubInfo;
};

export type Grant = {
  id: string;
  dedupe_key: string;
  name: string;
  organizer: string | null;
  url: string | null;
  amount: string | null;
  eligibility: string | null;
  deadline: string | null;
  fit_score: number | null;
  fit_reason: string | null;
  status: "new" | "interested" | "applied" | "ignored";
  reminded_14: boolean;
  reminded_3: boolean;
  created_at: string;
  last_seen_at: string;
};

