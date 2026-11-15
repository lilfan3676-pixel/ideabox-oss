import { metaModules } from "./meta";

// 模組提供的名稱表，合併成一張（瀏覽器與伺服器都能用）

export const MODULE_SOURCE_LABEL: Record<string, [string, string]> = Object.assign({}, ...metaModules.map((m) => m.sourceLabels ?? {}));
export const MODULE_PURPOSE: Record<string, { zh: string; en: string; product?: string }> = Object.assign({}, ...metaModules.map((m) => m.purposeLabels ?? {}));
