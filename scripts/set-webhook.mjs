// 用法：TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy APP_URL=https://你的網址 npm run setup:webhook
// 也可以把這三個值寫在 .env.local 或 setup.env，這支程式會自動讀取。
import { readFileSync, existsSync } from "node:fs";

for (const file of [".env.local", "setup.env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, APP_URL: app } = process.env;
if (!token || !secret || !app) {
  console.error("請先設定 TELEGRAM_BOT_TOKEN、TELEGRAM_WEBHOOK_SECRET、APP_URL");
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET 只能用英文字母、數字、_ 和 -");
  process.exit(1);
}

const url = `${app.replace(/\/+$/, "")}/api/telegram`;
const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
};

const r = await call("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
console.log("setWebhook:", r.ok ? "成功" : r.description);
await call("setMyCommands", {
  commands: [
    { command: "top", description: "本週最高分點子" },
    { command: "grants", description: "近期截止的補助／競賽" },
    { command: "week", description: "立即產生週報" },
    { command: "help", description: "使用說明" },
  ],
});
const info = await call("getWebhookInfo", {});
console.log("目前 webhook：", info.result?.url);
