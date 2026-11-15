# ideabox 手機 App（Expo）

只給主人自己用的唯讀 App：今天的排程、月曆、專案、點子、辦公室、產品燈號，加上推送通知。
資料都從你部署的 ideabox 網站的 `/api/app/*` 讀（`lib/app.ts`），App 裡不放任何資料庫金鑰。

- Expo SDK 57、expo-router（`src/app/`），iOS 原生分頁列
- 主題跟網頁一樣（Fluento／Ember／Portal × 淺／深色，`src/lib/theme.ts`），預設跟著網頁目前選的
- 配對：網頁「設定 → 手機 App」產生 QR code（10 分鐘、用一次）→ App 掃描或手動輸入網址與配對碼 → 拿到這台手機專用的憑證，存在鑰匙圈。網頁上解除配對後 App 自動回到配對畫面。
- 推送：有填時間的排程開始前 30 分鐘、早上 8 點的今日排程與里程碑、產品掛掉／恢復。

## 第一次設定

1. 改 `app.json`：`ios.bundleIdentifier`、`android.package` 換成你自己的（例如 `com.yourname.ideabox`）。
2. ```bash
   cd mobile
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest init      # 建立 Expo 專案，會把 extra.eas.projectId 寫進 app.json（推送一定要有）
   ```

## 在模擬器跑

```bash
cd mobile
LANG=en_US.UTF-8 npx expo run:ios
```

只改 JS 時用 `npx expo start` 就好。模擬器收不到推送（Expo 推送地址只有實機拿得到）。

## 裝到 iPhone

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios
```

送到 TestFlight 給自己用即可，不用公開上架（需要 Apple 開發者帳號）。

## 注意

- `ios/`、`android/` 是 `expo prebuild` 產生的，不要手改、不進版控。
- 這個資料夾不參與網頁的打包（根目錄 `tsconfig.json`、`.vercelignore` 排除）。
