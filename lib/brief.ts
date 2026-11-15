// 設計簡報（純函式，有單元測試）：把選入的收藏整理成可以直接貼給 Claude Design 的 Markdown
import type { DesignInfo } from "./db";

export type BriefItem = {
  summary: string | null;
  category: string | null;
  url: string | null;
  note: string | null;
  design: DesignInfo | null;
  imageUrl?: string;
};

function stars(n?: number) {
  if (n === undefined) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function buildBrief(items: BriefItem[], date: string, timeAgo: (iso?: string | null) => string): string {
  const out: string[] = [
    `# 設計參考簡報（${date}，共 ${items.length} 則）`,
    "",
    "以下是我收集的介面設計與 GitHub 資源。請學習它們的視覺風格、版面與互動手法，之後幫我設計時套用這些方向。",
  ];
  items.forEach((it, n) => {
    const d = it.design ?? {};
    const gh = d.github;
    out.push("", `## ${n + 1}. ${it.summary ?? it.url ?? "未命名"}`);
    out.push(`- 類型：${it.category === "github" ? "GitHub 資源" : "介面設計"}`);
    if (it.url) out.push(`- 連結：${it.url}`);
    if (it.imageUrl) out.push(`- 預覽圖：${it.imageUrl}`);
    if (gh) {
      const meta = [gh.repo, gh.stars !== undefined ? `⭐ ${stars(gh.stars)}` : "", gh.language ?? "", gh.license ?? "", gh.pushed_at ? `更新於 ${timeAgo(gh.pushed_at)}` : ""]
        .filter(Boolean)
        .join("・");
      out.push(`- GitHub：${meta}`);
      if (gh.description) out.push(`- 專案簡介：${gh.description}`);
    }
    if (d.styles?.length) out.push(`- 風格：${d.styles.join("、")}`);
    if (d.learn?.length) {
      out.push("- 值得學：");
      for (const l of d.learn) out.push(`  - ${l}`);
    }
    if (d.apply) out.push(`- 套用建議：${d.apply}`);
    if (it.note) out.push(`- 我的補充：${it.note.replace(/\n+/g, " ")}`);
  });
  return out.join("\n");
}
