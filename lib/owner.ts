import "server-only";
import { db } from "./db";
import { moduleDefaults } from "./modules/registry";

// 關於使用者自己的設定（設定頁填寫）：AI 分析點子、週報、找補助時會參考

const GENERIC_CONTEXT = "使用者是一位創業者，手上有幾個正在進行的產品與專案（還沒在設定頁填寫產品描述）。";
const GENERIC_PROFILE = "台灣的創業者";

async function setting(key: string): Promise<string> {
  const { data } = await db().from("settings").select("value").eq("key", key).maybeSingle();
  return ((data as { value: string } | null)?.value ?? "").trim();
}

/** 產品描述：還沒建專案、或專案沒填描述時，AI 用這段了解你在做什麼 */
export async function getOwnerContext(): Promise<string> {
  const legacy = moduleDefaults().legacyContextKey; // 模組可以指定舊版的設定名稱
  return (await setting("owner_context")) || (legacy ? await setting(legacy) : "") || moduleDefaults().ownerContext || GENERIC_CONTEXT;
}

/** 關於你（身分、所在地、階段），找補助時判斷資格用 */
export async function getOwnerProfile(): Promise<string> {
  return (await setting("owner_profile")) || moduleDefaults().ownerProfile || GENERIC_PROFILE;
}

/** 主要專案的短名：這個專案沒填描述時沿用產品描述 */
export function primaryProjectSlug(): string | null {
  return moduleDefaults().primaryProjectSlug ?? null;
}
