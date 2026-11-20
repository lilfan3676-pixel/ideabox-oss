import type { Metadata, Viewport } from "next";
// 字體：英數用 Plus Jakarta Sans（現代幾何感、數字好讀）；中文在蘋果裝置用內建蘋方，其他裝置用思源黑體
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "./globals.css";
import "./portal.css"; // Portal 主題（只在 data-theme="portal" 時生效）
import "./motion.css"; // 換頁、深淺色、主題切換的動態效果
import "./mobile.css"; // 手機簡易版（720px 以下）
import { getLang } from "@/lib/i18nServer";
import { LangProvider } from "./LangProvider";
import { LaunchIntro } from "./LaunchIntro";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await getLang()) === "en";
  return {
    title: en ? "ideabox · Founder console" : "ideabox 創業家主控台",
    description: en ? "Idea library and grant radar" : "Threads 點子庫與補助雷達",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// 在畫面繪製前套用上次選的主題，避免閃一下預設色
const THEME_INIT = `(function(){var d=document.documentElement;try{d.dataset.theme=localStorage.getItem('ib-theme')||'fluento';d.dataset.mode=localStorage.getItem('ib-mode')||'light';}catch(e){d.dataset.theme='fluento';d.dataset.mode='light';}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === "en" ? "en" : "zh-Hant"} data-theme="fluento" data-mode="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <LangProvider lang={lang}>{children}</LangProvider>
        <LaunchIntro />
      </body>
    </html>
  );
}
