// 中英文：只翻介面的字，排程標題、專案名稱照原樣。預設跟手機的語言，設定頁可以手動切
import { getPrefs } from "./prefs";

const device: "zh" | "en" = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
})();

export function lang(): "zh" | "en" {
  const p = getPrefs().lang;
  return p === "system" ? device : p;
}

/** 跟網頁的 L("中文", "English") 同一種寫法；畫面要用 usePrefs() 訂閱才會在切換語言時重畫 */
export const L = (zh: string, en: string) => (lang() === "en" ? en : zh);
