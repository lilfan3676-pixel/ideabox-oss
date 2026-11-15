// 分類與標籤（前後端共用，不含任何伺服器程式）
export type Category = "arx_feature" | "startup_idea" | "marketing" | "mindset" | "other" | "ui_design" | "github";

/** 設計類（點子庫裡用設計卡片顯示） */
export const DESIGN_CATEGORIES: Category[] = ["ui_design", "github"];
export const isDesign = (c: Category | null | undefined) => c === "ui_design" || c === "github";

export const CATEGORY_LABEL: Record<Category, string> = {
  arx_feature: "專案功能靈感",
  startup_idea: "新創業題目",
  marketing: "行銷手法",
  mindset: "心法觀點",
  other: "其他",
  ui_design: "介面設計",
  github: "GitHub 資源",
};


export const CATEGORY_LABEL_EN: Record<Category, string> = {
  arx_feature: "Project feature idea",
  startup_idea: "Startup idea",
  marketing: "Marketing",
  mindset: "Mindset",
  other: "Other",
  ui_design: "UI design",
  github: "GitHub resource",
};

/** 依介面語言取分類名稱 */
export function catLabel(c: Category | null | undefined, lang: "zh" | "en", fallback = lang === "en" ? "Uncategorized" : "未分類"): string {
  if (!c) return fallback;
  return (lang === "en" ? CATEGORY_LABEL_EN : CATEGORY_LABEL)[c] ?? fallback;
}
