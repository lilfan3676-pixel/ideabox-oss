import "server-only";
import { aiLangRule, getAiLang } from "./aiLang";
import { callStructured, type ContentBlock } from "./ai";
import { db, isDesign, type DesignInfo, type Idea } from "./db";
import { getOwnerContext } from "./owner";
import { env } from "./env";
import { autoFile, listFolders } from "./folders";
import { ideaProjects } from "./projects";
import type { ImageData } from "./images";
import { rulesPrompt } from "./learning";
import { logError } from "./sysLog";
import { bestFit, CATEGORIES, clampScore, cleanList, cleanProjectScores, cleanTags, cleanText, hasCjk, LENSES, LENS_INFO, lensFor, normalizeCategory, SCORING_VERSION, totalScore, type Scoring } from "./scoring";

type Analysis = {
  summary: string;
  category: string;
  tags: string[];
  score_arx: number;
  score_feasibility: number;
  score_market: number;
  score_reason: string;
  next_step: string;
  transcript?: string;
  styles?: string[];
  learn?: string[];
  apply?: string;
  folder?: string;
  same_as?: number;
  lens?: string;
  project_fit?: { project: string; score: number }[];
};

const SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "若附圖是貼文截圖，逐字轉錄圖中的文字；若是介面設計畫面或沒有圖，留空字串" },
    summary: { type: "string", description: "繁體中文，60 字以內。一般點子講清楚核心；設計類講清楚這是什麼介面／專案、亮點在哪" },
    category: {
      type: "string",
      enum: [...CATEGORIES],
      description:
        "arx_feature=可用在創業家現有專案的功能或體驗靈感；startup_idea=獨立的新創業題目；marketing=行銷/成長/社群經營手法；mindset=創業心法、觀點、方法論；ui_design=介面設計、視覺風格、版面、動效、UI 元件的參考；github=GitHub 上的程式專案或元件庫；other=都不是",
    },
    tags: { type: "array", items: { type: "string" }, description: "2～4 個繁中短標籤" },
    score_arx: {
      type: "integer", minimum: 1, maximum: 10,
      description: "對「最適合的那個專案」的適用度（有指定專案就看那個專案）。設計類（ui_design／github）：可以套用到這些專案或 ideabox 的程度。跟哪個專案都無關就給 1～3",
    },
    score_feasibility: {
      type: "integer", minimum: 1, maximum: 10,
      description: `「做得到嗎」，意思跟著 lens 換：${LENSES.map((l) => `${l}＝${LENS_INFO[l].easeAsk}`).join("；")}`,
    },
    score_market: {
      type: "integer", minimum: 1, maximum: 10,
      description: `「值不值得」，意思跟著 lens 換：${LENSES.map((l) => `${l}＝${LENS_INFO[l].valueAsk}`).join("；")}`,
    },
    lens: {
      type: "string",
      enum: [...LENSES],
      description: `評分角度：這則主要該從哪個面向看。${LENSES.map((l) => `${l}＝${LENS_INFO[l].name.zh}`).join("、")}。介面、網站、版面、視覺選 design；流程、工具、自動化、財務、客服、法務、補助選 operations`,
    },
    score_reason: { type: "string", description: "一句話說明評分理由（繁中），要點出最適合哪個專案、為什麼" },
    next_step: { type: "string", description: "一個具體、這週就能做的下一步（繁中，40 字內）" },
    styles: {
      type: "array", items: { type: "string" },
      description: "只有設計類才填：2～5 個風格標籤，例如「毛玻璃」「深色模式」「極簡」「粉紫漸層」「大字標題」",
    },
    learn: {
      type: "array", items: { type: "string" },
      description: "只有設計類才填：2～4 個值得學的元件或手法，每項 30 字內，例如「膠囊形分頁選單，選中變黑底」",
    },
    apply: { type: "string", description: "只有設計類才填：建議套用在哪個專案或 ideabox 的哪個畫面、怎麼用（60 字內）" },
  },
  required: ["summary", "category", "tags", "lens", "score_arx", "score_feasibility", "score_market", "score_reason", "next_step"],
};

const FIT_RULE =
  "project_fit 請對清單上「每一個」專案各打一個適用度（1～10）：這則對那個專案現在的階段有沒有用、用得上多少。專案之間要有差別，跟那個專案無關就給 1～3，不要為了客氣都給中間分數。";

/** 記下「可能跟哪一則重複」（migration-019 的欄位；還沒執行就略過） */
async function markDuplicate(idea: Idea, dupOf: string | null): Promise<Idea> {
  if ((idea.dup_of ?? null) === dupOf) return idea;
  const { data, error } = await db().from("ideas").update({ dup_of: dupOf }).eq("id", idea.id).select().single();
  return error || !data ? idea : (data as Idea);
}

export function hasMaterial(idea: Pick<Idea, "content" | "note">, image?: unknown): boolean {
  return Boolean((idea.content && idea.content.trim()) || (idea.note && idea.note.trim()) || image);
}

/** 比對重複用：這則之前存的點子（最近 60 則） */
async function earlierIdeas(idea: Idea): Promise<Pick<Idea, "id" | "summary">[]> {
  if (idea.dup_dismissed) return [];
  const { data } = await db()
    .from("ideas")
    .select("id, summary")
    .eq("status", "analyzed")
    .neq("id", idea.id)
    .lt("created_at", idea.created_at)
    .order("created_at", { ascending: false })
    .limit(60);
  return ((data ?? []) as Pick<Idea, "id" | "summary">[]).filter((x) => x.summary);
}

/** 分析一則點子並寫回資料庫。沒有任何內容時標成 needs_input。
 *  forceCategory：例如 GitHub 連結一定歸類為 github，不讓 AI 改。
 *  keepFiling：舊點子用新算法重評時用，分類、資料夾、重複標記都維持原樣。 */
export async function analyzeIdea(
  idea: Idea,
  image?: ImageData,
  opts: { forceCategory?: Idea["category"]; keepFiling?: boolean } = {},
): Promise<Idea> {
  if (!hasMaterial(idea, image)) {
    const { data } = await db().from("ideas").update({ status: "needs_input" }).eq("id", idea.id).select().single();
    return (data as Idea) ?? { ...idea, status: "needs_input" };
  }

  const { folders } = await listFolders();
  const { projects } = await ideaProjects().catch(() => ({ projects: [] as Awaited<ReturnType<typeof ideaProjects>>["projects"] }));
  const focus = idea.project_id ? projects.find((p) => p.id === idea.project_id) : undefined;
  const desc = (p: (typeof projects)[number]) => `${p.name}：${p.description?.trim() || "（沒有描述）"}`;
  const projectLines = focus
    ? [
        "創業家手上的專案：",
        ...projects.map((p) => `- ${desc(p)}`),
        `這則點子是創業家指定給「${focus.name}」專案的：score_arx 請評「對 ${focus.name} 的適用度」，next_step 也請針對 ${focus.name}。`,
        FIT_RULE,
      ]
    : projects.length
      ? ["創業家手上的專案：", ...projects.map((p) => `- ${desc(p)}`), "每個專案同等重要，不要偏向清單上的第一個。score_arx 請評「對最適合那個專案的適用度」，next_step 也針對那個專案。", FIT_RULE]
      : [`創業家正在做的產品：${await getOwnerContext()}`];
  const earlier = opts.keepFiling ? [] : await earlierIdeas(idea).catch(() => []);
  const schema = {
    ...SCHEMA,
    properties: {
      ...SCHEMA.properties,
      ...(projects.length
        ? {
            project_fit: {
              type: "array",
              description: "每個專案各一筆，清單上的專案都要有",
              items: {
                type: "object",
                properties: { project: { type: "string", enum: projects.map((p) => p.name) }, score: { type: "integer", minimum: 1, maximum: 10 } },
                required: ["project", "score"],
              },
            },
          }
        : {}),
      ...(folders.length ? { folder: { type: "string", enum: folders.map((f) => f.name), description: "從創業家的資料夾中，選最適合放這則的一個；資料夾名稱就是用途，例如補助、競賽、創業貸款、申請心得、公司設立這類放「補助計劃」（如果有這個資料夾）" } } : {}),
      ...(earlier.length
        ? { same_as: { type: "integer", minimum: 0, maximum: earlier.length, description: "只有確定跟「之前存的點子」清單裡某一則是「同一個」東西才填那則的編號：同一個 GitHub 專案（專案名稱相同）、同一篇貼文、同一個產品或網站。不同人寫同一個主題、同一個比賽或補助的不同心得、相似的工具，都不算重複。拿不準就填 0" } }
        : {}),
    },
  };
  const system = [
    "你是一位幫台灣創業家整理靈感的分析助理，所有輸出使用繁體中文；原文是英文或其他語言時也一樣要寫成繁體中文。",
    ...projectLines,
    "創業家也在做一個叫 ideabox 的個人創業主控台（毛玻璃風格的網頁儀表板）。",
    "請根據提供的內容（文字、截圖、GitHub 資訊）與創業家的補充，做摘要、分類與評分。評分要誠實、有鑑別度，不要都給中間分數。",
    "評分分三項：① 對最適合專案的適用度 ② 做得到嗎 ③ 值不值得。先選評分角度 lens（設計、產品功能、行銷成長、營運流程、商業題目、觀點心法），②③ 就照那個角度的定義評：例如行銷手法看「好不好執行／預期成效」，營運工具看「好不好導入／省多少時間與錢」，不要每一則都用「市場潛力」來評。",
    "如果內容主要在展示介面畫面、視覺風格、版面或動效，分類為 ui_design；GitHub 專案分類為 github。設計類請填 styles、learn、apply。",
    opts.forceCategory ? `這則已確定分類為 ${opts.forceCategory}。` : "",
    await rulesPrompt("idea"),
    await aiLangRule(),
  ]
    .filter(Boolean)
    .join("\n");

  const lines: string[] = [];
  if (idea.author) lines.push(`作者：${idea.author}`);
  if (idea.url) lines.push(`連結：${idea.url}`);
  if (idea.content) lines.push(`內容：\n${idea.content.slice(0, 8000)}`);
  if (idea.note) lines.push(`創業家的補充：${idea.note.slice(0, 2000)}`);
  if (image) lines.push("（附圖為貼文截圖或預覽圖）");
  if (earlier.length) lines.push(`之前存的點子（比對是否重複用）：\n${earlier.map((x, n) => `${n + 1}. ${String(x.summary).slice(0, 60)}`).join("\n")}`);

  const content: ContentBlock[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  content.push({ type: "text", text: lines.join("\n\n") });

  try {
    const ask = (extra = "") =>
      callStructured<Analysis>({
        model: env.analyzeModel(),
        system: system + extra,
        content,
        toolName: "save_analysis",
        toolDescription: "儲存這則點子的分析結果",
        schema,
        maxTokens: image ? 2000 : 1200,
        purpose: "idea_analysis",
      });
    let r = await ask();
    // 原文是英文時偶爾會整段寫成英文：中文模式下重問一次
    if ((await getAiLang()) === "zh" && !hasCjk(cleanText(r.summary, 200))) {
      r = await ask("\n上一次你寫成了英文。這次每個文字欄位都一定要用繁體中文。");
    }
    const category = opts.forceCategory ?? normalizeCategory(r.category);
    // 每個專案各一分；綜合分數裡的「適用度」＝指定的專案，沒指定就取最高的那個
    const fits = cleanProjectScores(r.project_fit, projects);
    const best = bestFit(fits, idea.project_id, projects.map((p) => p.id));
    const own = clampScore(r.score_arx);
    // 設計類也可能是給 ideabox 自己用的（不在專案清單裡），所以取兩者較高的
    const a = best ? (isDesign(category) && own !== null ? Math.max(best.score, own) : best.score) : own;
    const scoring: Scoring = { v: SCORING_VERSION, lens: lensFor(category, r.lens), ...(Object.keys(fits).length ? { projects: fits } : {}) };
    const f = clampScore(r.score_feasibility);
    const m = clampScore(r.score_market);
    const update: Partial<Idea> = {
      status: "analyzed",
      summary: cleanText(r.summary, 200) || null,
      category,
      tags: cleanTags(r.tags),
      score_arx: a,
      score_feasibility: f,
      score_market: m,
      score_total: totalScore(a, f, m),
      score_reason: cleanText(r.score_reason, 300) || null,
      next_step: cleanText(r.next_step, 200) || null,
      analyzed_at: new Date().toISOString(),
      analyze_attempts: idea.analyze_attempts + 1,
    };
    if (isDesign(category)) {
      const design: DesignInfo = {
        ...(idea.design ?? {}), // 保留抓取時存的 GitHub 資訊
        styles: cleanList(r.styles, 5, 20),
        learn: cleanList(r.learn, 4, 60),
        apply: cleanText(r.apply, 200) || undefined,
      };
      update.design = design;
    }
    if (image && r.transcript && r.transcript.trim() && !idea.content) update.content = r.transcript.trim().slice(0, 6000);
    let { data, error } = await db().from("ideas").update({ ...update, scoring }).eq("id", idea.id).select().single();
    // 還沒執行 migration-033（沒有 scoring 欄位）：分數照新算法存，只是不記角度與各專案分數
    if (error && /scoring/i.test(error.message ?? "")) ({ data, error } = await db().from("ideas").update(update).eq("id", idea.id).select().single());
    if (error) throw error;
    let saved = data as Idea;
    // 批次重評（keepFiling）只換分數與下一步，不動資料夾、也不重新比對重複
    if (opts.keepFiling) return saved;
    if (earlier.length) saved = await markDuplicate(saved, earlier[Number(r.same_as) - 1]?.id ?? null);
    return await autoFile(saved, r.folder, folders);
  } catch (err) {
    console.error("analyzeIdea failed", idea.id, err);
    await logError("idea_analysis", err);
    const { data } = await db()
      .from("ideas")
      .update({ status: "failed", analyze_attempts: idea.analyze_attempts + 1 })
      .eq("id", idea.id)
      .select()
      .single();
    return (data as Idea) ?? { ...idea, status: "failed" };
  }
}
