import "server-only";
import { db } from "./db";
import type { Lang } from "./i18n";

// AI 輸出語言：跟著介面語言（存在 settings.ui_lang，Telegram 與排程也讀得到）
let cache: { at: number; lang: Lang } | null = null;

export async function getAiLang(): Promise<Lang> {
  if (cache && Date.now() - cache.at < 30_000) return cache.lang;
  let lang: Lang = "zh";
  try {
    const { data } = await db().from("settings").select("value").eq("key", "ui_lang").maybeSingle();
    if ((data as { value: string } | null)?.value === "en") lang = "en";
  } catch {
    /* 讀不到就用中文 */
  }
  cache = { at: Date.now(), lang };
  return lang;
}

/** 放在 system prompt 最後，覆蓋前面「使用繁體中文」的要求 */
export async function aiLangRule(): Promise<string> {
  return (await getAiLang()) === "en"
    ? "LANGUAGE OVERRIDE: Write every text field / the whole answer in natural, plain English (ignore any earlier instruction to use Traditional Chinese). Keep product names and official program names (e.g. grant or competition names) as-is."
    : "";
}
