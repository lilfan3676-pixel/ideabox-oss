# ideabox｜創業家主控台

[English](README.en.md)

一個人用的創業主控台：把滑到的好點子丟給 Telegram Bot，AI 幫你摘要、分類、評分、放進資料夾；專案的階段、里程碑、排程放在同一個地方；成本、補助、產品有沒有掛掉、電腦上的 Claude Code 在做什麼，也都看得到。

技術：Next.js 16（App Router）＋ React 19 ＋ Supabase ＋ Vercel ＋ Claude API ＋ Telegram Bot，另有 Expo 手機 App（唯讀）。

> 這是給「自己一個人」用的工具：只有一個登入帳號、一個 Telegram 主人。每個人各自部署一份。
>
> 📖 **每個功能怎麼用：[使用說明](docs/使用說明.md)**

---

## 功能

| 頁面 | 做什麼 |
|---|---|
| 點子庫 `/` | Telegram 傳連結、截圖、文字進來 → AI 摘要、分類、評分（對專案的參考價值／可行性／市場），自動放進資料夾、標出可能重複的點子。資料夾可拖曳、改名、換色；設計類點子另外有設計卡片與「設計簡報」 |
| 專案 `/projects` | 每個專案自訂階段、下一步、里程碑、工作日誌；月曆（排程）與時程表；狀態進行中／暫停／完成 |
| 專案詳細頁 | 階段歷程、這個專案的點子、產品數據、**話題雷達**（每週日用 Apify 抓 Threads 上的關鍵字討論，AI 整理成主題與痛點） |
| 辦公室 `/office` | 電腦上每個執行中的 Claude Code 變成一個像素小人，看得到它的職位、狀態、在做什麼（用 Claude Code hook 回報） |
| 補助雷達 `/grants` | 每週日 AI 上網找台灣的創業補助與競賽，截止前 14／3 天提醒 |
| 監控 `/monitor` | 加網址就會每 5 分鐘檢查網站有沒有活著，掛掉／恢復傳 Telegram 與手機推送；每週一系統健康檢查 |
| 成本 `/costs` | 訂閱、一次性開銷、AI 用量（自動記錄每次呼叫 Claude 的費用），總預算與還能撐幾個月 |
| 設定 `/settings` | 關於你、專案描述（AI 分析時參考）、外觀、週報、AI 學到的偏好、手機 App 配對 |

其他：
- **Telegram Bot**：存點子、回覆補充、改資料夾、指定專案；「專案」看總覽、「myapp 下一步 ＿＿」「myapp 里程碑 12/1 上架」「myapp 排程 11/20-11/25 封測」直接更新專案
- **Slack 進度回報**（選填）：每個專案一個頻道，讀到「【完成】【下一步】【階段】」格式的訊息就自動更新專案
- **中英雙語**介面、三種主題（Fluento／Ember／Portal）× 淺色／深色
- **AI 自我學習**：從你採用、刪除、補充的點子學偏好，之後分析會參考
- **手機 App**（`mobile/`）：今天的排程、月曆、專案、點子、辦公室，加推送通知

---

## 一、部署（約 30–40 分鐘）

需要的帳號：GitHub、Vercel、Supabase、Anthropic（Claude API）、Telegram。都有免費方案（Claude API 依用量付費，見「成本估算」）。

### 1. 複製這個 repo
在 GitHub 按 **Fork**（或 **Use this template**）到你自己的帳號。

### 2. Supabase（資料庫＋登入）
1. 到 [supabase.com](https://supabase.com) 建立新專案（區域選離你近的，例如 Tokyo）。
2. 左側 **SQL Editor** → 打開 `supabase/schema.sql`，**先把第一段的 `https://YOUR-APP.vercel.app` 換成你等一下的 Vercel 網址**（還不知道可以先不改，部署後再改）→ 全部貼上 → **Run**。
3. **Authentication → Users → Add user → Create new user**：填你的 Email 與密碼，勾選 *Auto Confirm User*。這就是登入主控台的帳號。
4. **Authentication → Sign In / Providers → Email**：關掉 *Allow new users to sign up*（避免別人註冊）。
5. **Project Settings → API**：記下 `Project URL`、`anon public` key、`service_role` key。

### 3. Telegram Bot
在 Telegram 搜尋 **@BotFather** → `/newbot` → 取名字 → 拿到 Bot Token。

### 4. Claude API
到 [console.anthropic.com](https://console.anthropic.com) 建立 API Key，建議在 **Billing → Limits** 設每月上限（例如 US$15）。

### 5. 部署到 Vercel
1. Vercel → **Add New → Project** → 匯入你 fork 的 repo（Framework 會自動選 Next.js）。
2. **Environment Variables** 依照 `.env.example` 填：
   - `TELEGRAM_WEBHOOK_SECRET`、`CRON_SECRET`：各自打一串 32 字以上的英數字（兩個要不同）
   - `OWNER_EMAIL`：剛剛在 Supabase 建的登入 Email
   - `TELEGRAM_OWNER_ID`：**先留空**
   - `APP_URL`：先留空，部署完拿到網址再補
3. **Deploy**。完成後拿到網址（例如 `https://my-ideabox.vercel.app`）→ 回到 **Settings → Environment Variables** 補上 `APP_URL` → **Deployments → Redeploy**。
4. 如果第 2 步沒改網址：Supabase → **Table Editor → settings**，把 `app_url` 那列的 value 改成你的網址（結尾不要斜線）。

> Vercel 免費方案：`vercel.json` 裡的每日排程（台北 21:00）免費方案可以用；區域預設 `hnd1`（東京），可以改成離你近的。

### 6. 連上 Telegram
1. 在電腦上 clone 你的 repo，建立 `.env.local`，填 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`APP_URL`，然後：
   ```bash
   npm install
   npm run setup:webhook
   ```
   看到「setWebhook: 成功」就完成。
2. 在 Telegram 傳任何訊息給你的 Bot，它會回覆你的 Telegram ID → 填進 Vercel 的 `TELEGRAM_OWNER_ID` → **Redeploy**。之後 Bot 只回應你一個人。

### 7. 驗收
- 打開你的網址，用 Supabase 建的帳號登入。
- 在 Threads 任一貼文按「分享」→ Telegram → 你的 Bot，幾秒內會收到分析結果。
- 到「專案」新增第一個專案；到「設定 → 專案描述」寫一句「關於你」，AI 分析與補助雷達會更準。
- 到「監控」加你自己網站的網址。

---

## 二、選填功能

| 功能 | 怎麼開 |
|---|---|
| 話題雷達 | 到 apify.com 註冊，填 `APIFY_TOKEN`；在專案詳細頁設最多 5 個關鍵字。每次抓取費用上限 1 美元 |
| Slack 進度回報 | 建一個 Slack App，Bot 權限 `channels:read channels:history channels:join groups:read groups:history`，填 `SLACK_BOT_TOKEN`。每個專案一個頻道（預設 `#progress-短名`），私人頻道要邀請 Bot |
| 辦公室（Claude Code） | 見下方「辦公室設定」 |
| GitHub 專案資訊 | 填 `GITHUB_TOKEN`（唯讀即可），額度從每小時 60 次變 5000 次 |
| 手機 App | 見 `mobile/README.md` |

### 辦公室設定（Claude Code hook）
1. 在 Vercel 加環境變數 `CLAUDE_HOOK_SECRET`（自己打一串英數字）並 Redeploy。
2. 電腦上：
   ```bash
   mkdir -p ~/.claude/hooks
   cp tools/claude-hook/ideabox-office.sh ~/.claude/hooks/
   chmod +x ~/.claude/hooks/ideabox-office.sh
   printf '%s' '跟 CLAUDE_HOOK_SECRET 一樣的那串' > ~/.claude/ideabox-hook.secret
   printf '%s' 'https://my-ideabox.vercel.app' > ~/.claude/ideabox-hook.url
   ```
3. 在 `~/.claude/settings.json` 的 `hooks` 加上 `SessionStart`、`UserPromptSubmit`、`PostToolUse`、`Notification`、`Stop`、`SessionEnd`，每個都執行 `~/.claude/hooks/ideabox-office.sh` 並設 `"async": true`。
4. 到「專案 → 設定」填「資料夾名稱」：路徑裡任一層等於這個名稱的 Claude Code 就會出現在那個專案的房間。

你打給 Claude 的原文**不會**存起來：只會先遮掉金鑰，再讓 AI 濃縮成「職位＋一句話任務」。

---

## 三、加上你自己的功能（模組）

核心程式不認識任何特定產品。想加自己的東西（例如自己 App 的後台數字、自己的資料清單），寫成模組，不用改核心：

- `lib/modules/server.ts`：伺服器端模組清單。模組可以提供：每日排程要做的事、產品監控（更多服務與使用者數字）、健康檢查項目、右上角鈴鐺的待處理數、Telegram 的其他存放地點（例如「地點清單」，會自動加上分流與「改存到…」按鈕）、專案詳細頁的回報數。
- `lib/modules/meta.tsx`：畫面上的頁面、左側檢視、手機分頁、紀錄名稱。
- 型別與說明都在 `lib/modules/types.ts`。

新頁面照一般 Next.js 寫在 `app/(dash)/你的頁面/`，再把它列進 `meta.tsx` 的 `pages` 就會出現在上方選單。

---

## 四、日常使用

| 想做的事 | 怎麼做 |
|---|---|
| 存 Threads 貼文 | 分享 → Telegram → Bot。連結旁打的字會當成你的補充 |
| 一次存多則 | 一則訊息貼多個連結（最多 10 個） |
| 讀不到內容時 | Bot 會提示，直接**回覆那則訊息**補一句重點 |
| 存截圖／靈感 | 直接傳圖片或打字給 Bot |
| 看本週最高分／近期補助／週報 | `/top`、`/grants`、`/week` |
| 更新專案 | 「專案」、「myapp 下一步 ＿＿」「myapp 下一階段」「myapp 記錄 ＿＿」「myapp 里程碑 12/1 ＿＿」「myapp 排程 12/1 14:00 開會」 |

**排程**
- Vercel Cron 每天台北 21:00：重試失敗的分析、成本扣款日與續約提醒、補助截止提醒；週日另外跑補助雷達、AI 學習、週報。
- Supabase pg_cron：每 5 分鐘產品監控＋Slack 同步＋手機排程提醒；每天台北 08:00 專案總覽；每週一台北 09:00 健康檢查。

## 五、成本估算（每月）
- Vercel、Supabase、Telegram：免費方案即可（Supabase 免費專案閒置 7 天會暫停，每日排程會保持活躍）。
- Claude API：每則點子約 NT$0.1～0.3（Haiku）；每週補助雷達約 NT$5～15（Sonnet＋網路搜尋）。每月存 200 則、跑 4 次雷達約 NT$100～150。實際花費在「成本 → AI 用量」看得到。

## 六、已知限制
- **Threads 內容讀取不保證成功**：讀的是分享預覽資訊；被擋時會存下連結、等你補充。有 Meta 開發者帳號可以填 `THREADS_ACCESS_TOKEN` 當備援。
- **補助資訊以官方公告為準**：AI 會搜尋並附出處，截止日與資格請點進官網確認。
- 補助雷達、AI 提示目前以台灣、繁體中文為主（介面可以切英文）。

## 七、開發
```bash
npm install
cp .env.example .env.local   # 填入設定
npm run dev                  # http://localhost:3000
npm test                     # 單元與流程測試（vitest，外部 API 都用假的）
npx tsc --noEmit             # 型別檢查
```

主要檔案：

```
app/(dash)/             主控台各頁
app/api/telegram/       Telegram Bot 入口（驗證 secret、只接受主人）
app/api/cron/daily/     每日排程
app/api/*/tick/         pg_cron 呼叫的排程（監控、專案、健康檢查）
app/api/claude/hook/    辦公室：Claude Code hook 回報
app/api/app/            手機 App 的 API
lib/analyze.ts          AI 摘要分類評分
lib/ai.ts               呼叫 Claude（每次都記錄用途與費用）
lib/modules/            模組（外掛）介面
supabase/schema.sql     資料庫結構（整份）
tools/claude-hook/      辦公室用的 Claude Code hook 腳本
mobile/                 Expo 手機 App
```

## 授權
[MIT](LICENSE)。AI 產生的內容僅供參考。
