// 所有環境變數集中在這裡讀取。只在執行時讀，避免 build 階段因缺值而失敗。

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`缺少環境變數 ${name}`);
  return v.trim();
}

export function optional(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

/** 只保留 https://xxx.supabase.co，去掉誤貼的 /rest/v1/ 等路徑 */
export function cleanSupabaseUrl(u: string): string {
  return u.trim().replace(/\/(rest|auth)\/v1.*$/, "").replace(/\/+$/, "");
}

export const env = {
  supabaseUrl: () => cleanSupabaseUrl(required("NEXT_PUBLIC_SUPABASE_URL")),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  ownerEmail: () => required("OWNER_EMAIL").toLowerCase(),

  telegramToken: () => required("TELEGRAM_BOT_TOKEN"),
  telegramWebhookSecret: () => required("TELEGRAM_WEBHOOK_SECRET"),
  telegramOwnerId: () => optional("TELEGRAM_OWNER_ID"),

  anthropicKey: () => required("ANTHROPIC_API_KEY"),
  analyzeModel: () => optional("ANTHROPIC_MODEL_FAST", "claude-haiku-5-5"),
  researchModel: () => optional("ANTHROPIC_MODEL_RESEARCH", "claude-sonnet-5-5"),
  webSearchTool: () => optional("ANTHROPIC_WEB_SEARCH_TOOL", "web_search_20250305"),

  threadsAccessToken: () => optional("THREADS_ACCESS_TOKEN"),
  githubToken: () => optional("GITHUB_TOKEN"),
  // Slack 進度回報（ideabox 工作空間的 Bot，只讀頻道訊息；沒設定就略過）
  slackBotToken: () => optional("SLACK_BOT_TOKEN"),
  // 辦公室：電腦上 Claude Code hook 回報用的密鑰（沒設定就不收）
  claudeHookSecret: () => optional("CLAUDE_HOOK_SECRET"),
  // 話題雷達：Apify 的 API token（抓 Threads 關鍵字貼文；沒設定就不抓）
  apifyToken: () => optional("APIFY_TOKEN"),
  cronSecret: () => required("CRON_SECRET"),

  appUrl: () => optional("APP_URL"),
};
