-- ideabox 資料庫結構（完整版）：在 Supabase「SQL Editor」整段貼上執行一次即可，重複執行也不會出錯。
--
-- ⚠️ 執行前先改一個地方：下面「0. 你的網址」那行，把 https://YOUR-APP.vercel.app 換成你部署到 Vercel 後的網址。
--    （還沒部署也可以先執行，之後再到 Table Editor → settings 把 app_url 改掉，排程會自動用新網址。）
--
-- 所有資料表都開啟 RLS 且不設任何 policy：瀏覽器端（anon key）一律讀不到，
-- 只有伺服器端使用 service role key 才能存取。

create extension if not exists pgcrypto;

-- ========== 設定 ==========
create table if not exists public.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;

-- 0. 你的網址（排程會呼叫這個網址；結尾不要加斜線）
insert into public.settings (key, value) values ('app_url', 'https://YOUR-APP.vercel.app')
on conflict (key) do nothing;

-- 排程用的密鑰：由資料庫自己產生，不需要複製貼上
create extension if not exists pgcrypto with schema extensions;
insert into public.settings (key, value)
values ('monitor_tick_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- ========== 專案 ==========
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,                 -- Telegram 指令用的短名，例如 myapp
  name text not null,
  stages jsonb not null default '[]'::jsonb, -- 階段名稱陣列
  stage int not null default 0,              -- 目前在第幾個階段（從 0 開始）
  next_step text,
  status text not null default 'active' check (status in ('active', 'paused', 'done')),
  folder text,                               -- 電腦上的資料夾名稱（辦公室畫面對應 Claude Code 用）
  repo text,                                 -- GitHub repo，例如 owner/name
  sort int not null default 0,
  description text,                          -- 一句話描述（AI 分析點子時參考）
  slack_channel text,                        -- Slack 頻道名稱（空的就用 progress-短名）
  links jsonb not null default '{}'::jsonb,  -- 官網與社群連結
  radar_keywords text[] not null default '{}', -- 話題雷達的關鍵字（最多 5 個）
  last_activity_at timestamptz not null default now(),
  stale_asked_at timestamptz,                -- 上次問「還在做嗎？」的時間
  created_at timestamptz not null default now()
);

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  due date not null,
  done boolean not null default false,
  reminded_7 boolean not null default false,
  reminded_1 boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists project_milestones_due_idx on public.project_milestones (due);

create table if not exists public.project_logs (
  id bigserial primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'telegram', 'claude', 'github', 'slack', 'system')),
  text text not null
);
create index if not exists project_logs_project_at_idx on public.project_logs (project_id, at desc);

-- 排程（月曆上有實際日期的工作）；start_time 選填（台北時間），有填的開始前 30 分鐘推送到手機
create table if not exists public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,               -- 單日的事情 = 開始日
  start_time time,
  reminded boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'telegram', 'slack')),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists project_events_range_idx on public.project_events (start_date, end_date);
create index if not exists project_events_remind_idx on public.project_events (start_date) where start_time is not null and not reminded;

alter table public.projects enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_logs enable row level security;
alter table public.project_events enable row level security;

-- ========== 點子庫 ==========
-- 資料夾（只有一層）。category 有值的是預設資料夾，AI 猜不到時用分類對應
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int not null default 0,
  category text unique,
  color text,
  created_at timestamptz not null default now()
);
alter table public.folders enable row level security;

insert into public.folders (name, sort, category) values
  ('專案功能靈感', 10, 'arx_feature'),
  ('新創業題目', 20, 'startup_idea'),
  ('行銷手法', 30, 'marketing'),
  ('心法觀點', 40, 'mindset'),
  ('介面設計', 50, 'ui_design'),
  ('GitHub 資源', 60, 'github'),
  ('其他', 70, 'other')
on conflict (category) do nothing;

-- 欄位名稱說明：score_arx 是「對專案的參考價值」分數、arx_feature 是「專案功能靈感」分類（沿用舊名稱）
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'threads' check (source in ('threads', 'text', 'photo', 'link')),
  url text,
  post_key text unique,              -- 去重用；純文字點子為 null
  author text,
  content text,                      -- 貼文原文（或截圖辨識出的文字）
  note text,                         -- 你自己補充的重點
  status text not null default 'pending'
    check (status in ('pending', 'needs_input', 'analyzed', 'failed')),
  summary text,
  category text check (category in ('arx_feature', 'startup_idea', 'marketing', 'mindset', 'other', 'ui_design', 'github')),
  tags text[] not null default '{}',
  score_arx smallint,
  score_feasibility smallint,
  score_market smallint,
  score_total numeric(4, 1),
  score_reason text,
  next_step text,
  adopted boolean not null default false,
  telegram_message_id bigint,        -- Bot 回覆訊息的 id，用來對應「回覆補充」
  telegram_file_id text,             -- 截圖的 Telegram 檔案 id（重新分析時用）
  image_path text,                   -- 圖片在 Storage 的路徑
  design jsonb,                      -- 設計類：風格、手法、套用建議、GitHub 資訊
  in_brief boolean not null default false,
  analyze_attempts smallint not null default 0,
  folder_id uuid references public.folders (id) on delete set null,
  folder_locked boolean not null default false, -- 手動搬過，AI 重新分析時不再自動改
  project_id uuid references public.projects (id) on delete set null,
  dup_of uuid references public.ideas (id) on delete set null, -- AI 判斷可能重複的那一則
  dup_dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);
create index if not exists ideas_created_at_idx on public.ideas (created_at desc);
create index if not exists ideas_tg_msg_idx on public.ideas (telegram_message_id);
create index if not exists ideas_category_idx on public.ideas (category);
create index if not exists ideas_folder_idx on public.ideas (folder_id);
create index if not exists ideas_project_idx on public.ideas (project_id);
alter table public.ideas enable row level security;

-- 圖片儲存空間（私有，只有伺服器能讀寫）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('idea-images', 'idea-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- ========== 補助／競賽雷達 ==========
create table if not exists public.grants (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  name text not null,
  organizer text,
  url text,
  amount text,
  eligibility text,
  deadline date,                     -- null 代表常態受理或未公布
  fit_score smallint,
  fit_reason text,
  status text not null default 'new' check (status in ('new', 'interested', 'applied', 'ignored')),
  reminded_14 boolean not null default false,
  reminded_3 boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists grants_deadline_idx on public.grants (deadline);
alter table public.grants enable row level security;

-- ========== 話題雷達 ==========
create table if not exists public.radar_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  keywords text[] not null default '{}',
  post_count int not null default 0,
  summary jsonb,
  idea_ids uuid[] not null default '{}',
  error text
);
create index if not exists radar_reports_project_idx on public.radar_reports (project_id, created_at desc);
alter table public.radar_reports enable row level security;

-- ========== 成本 ==========
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product text not null default 'shared',  -- 專案短名、ideabox 或 shared（共用）
  kind text not null check (kind in ('subscription', 'one_time')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'TWD' check (currency in ('TWD', 'USD')),
  cycle text check (cycle in ('monthly', 'yearly')),   -- 訂閱才有
  next_due date,                                        -- 訂閱：下次扣款日
  paid_on date,                                         -- 一次性：付款日
  started_on date,                                      -- 訂閱：開始訂閱日（選填）
  note text,
  active boolean not null default true,
  reminded_for date,                                    -- 已提醒過的扣款日
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  model text not null,
  purpose text not null,
  product text not null default 'ideabox',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  web_searches int not null default 0,
  usd numeric(12, 6) not null default 0
);
create index if not exists ai_usage_at_idx on public.ai_usage (at);

alter table public.expenses enable row level security;
alter table public.ai_usage enable row level security;

-- ========== 產品監控 ==========
create table if not exists public.monitor_status (
  service text primary key,
  product text not null,
  ok boolean not null default true,      -- 連續失敗 2 次才算異常
  fail_count int not null default 0,
  changed_at timestamptz not null default now(),
  checked_at timestamptz,
  latency_ms int,
  last_error text,
  notified_down boolean not null default false,
  warned_on date                         -- 資料庫用量警告最後一次通知的日期
);

create table if not exists public.monitor_daily (
  product text not null,
  day date not null,
  users int,
  active7 int,
  new7 int,
  db_bytes bigint,
  updated_at timestamptz not null default now(),
  primary key (product, day)
);

alter table public.monitor_status enable row level security;
alter table public.monitor_daily enable row level security;

-- ========== 健康檢查與 AI 自我學習 ==========
create table if not exists public.sys_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('run', 'error')),
  source text not null,
  ok boolean not null default true,
  detail text,
  ms int
);
create index if not exists sys_events_at_idx on public.sys_events (at);

create table if not exists public.feedback_signals (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  scope text not null check (scope in ('idea', 'grant')),
  action text not null,
  ref_id text,
  snapshot jsonb not null default '{}'::jsonb,
  learned boolean not null default false
);
create index if not exists feedback_signals_learned_idx on public.feedback_signals (learned, at);

create table if not exists public.learned_rules (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('idea', 'grant')),
  rule text not null,
  evidence int not null default 1,
  active boolean not null default true,   -- false = 你刪掉的，之後不會再學回來
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sys_events enable row level security;
alter table public.feedback_signals enable row level security;
alter table public.learned_rules enable row level security;

-- ========== 辦公室（Claude Code hook） ==========
create table if not exists public.agent_sessions (
  session_id text primary key,
  project_id uuid references public.projects (id) on delete set null, -- 對不到專案 = 在大廳
  folder text,
  role text,                           -- 職位，例如「前端工程師」
  role_locked boolean not null default false, -- 手動指定過職位
  task text,                           -- 在做什麼（AI 濃縮的一句話，不存你打的原文）
  status text not null default 'idle' check (status in ('idle', 'working', 'waiting', 'permission', 'ended')),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists agent_sessions_updated_idx on public.agent_sessions (updated_at desc);
alter table public.agent_sessions enable row level security;

-- ========== 手機 App ==========
create table if not exists public.app_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null default '手機',
  token_hash text not null unique,       -- 只存雜湊值
  push_token text,                       -- Expo 推送地址
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.app_devices enable row level security;

-- ========== 排程（pg_cron 呼叫你的網站） ==========
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- 共用：呼叫網站的某個排程網址（網址讀 settings.app_url，密鑰讀 settings.monitor_tick_secret）
create or replace function public.ideabox_tick(path text, timeout_ms int default 30000)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := (select value from public.settings where key = 'app_url') || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monitor-secret', (select value from public.settings where key = 'monitor_tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := timeout_ms
  );
$$;
revoke all on function public.ideabox_tick(text, int) from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job
  where jobname in ('ideabox-monitor', 'ideabox-health', 'ideabox-projects', 'ideabox-monitor-cleanup');
end $$;

-- 每 5 分鐘：產品監控、Slack 進度、手機排程提醒
select cron.schedule('ideabox-monitor', '*/5 * * * *', $$ select public.ideabox_tick('/api/monitor/tick', 30000); $$);
-- 每週一台北 09:00（UTC 週一 01:00）：健康檢查，有問題才傳 Telegram
select cron.schedule('ideabox-health', '0 1 * * 1', $$ select public.ideabox_tick('/api/health/tick', 60000); $$);
-- 每天台北 08:00（UTC 00:00）：專案總覽、里程碑提醒；週日另外跑話題雷達
select cron.schedule('ideabox-projects', '0 0 * * *', $$ select public.ideabox_tick('/api/projects/tick', 60000); $$);
-- pg_net 的回應紀錄只留 1 天，避免佔空間
select cron.schedule('ideabox-monitor-cleanup', '17 4 * * *', $$ delete from net._http_response where created < now() - interval '1 day'; $$);
