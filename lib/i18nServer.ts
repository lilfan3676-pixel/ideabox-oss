import "server-only";
import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, makeL, type Lang, type Translate } from "./i18n";

/** 伺服器端讀目前介面語言（存在 cookie） */
export async function getLang(): Promise<Lang> {
  try {
    const v = (await cookies()).get(LANG_COOKIE)?.value;
    return isLang(v) ? v : "zh";
  } catch {
    return "zh";
  }
}

export async function getL(): Promise<Translate> {
  return makeL(await getLang());
}
