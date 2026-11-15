// 介面語言（前後端共用）。用法：L("點子庫", "Ideas")——中英文寫在同一處，好對照也不會漏。
export type Lang = "zh" | "en";
export const LANG_COOKIE = "ib-lang";
export const isLang = (v: unknown): v is Lang => v === "zh" || v === "en";
export type Translate = (zh: string, en: string) => string;
export const makeL = (lang: Lang): Translate => (zh, en) => (lang === "en" ? en : zh);
