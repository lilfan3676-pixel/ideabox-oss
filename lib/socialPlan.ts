import "server-only";
import { callStructured } from "./ai";
import { auditForPrompt, auditOf } from "./auditLogic";
import { db } from "./db";
import { env } from "./env";
import { parseTime } from "./appTime";
import { DEFAULT_TIME, FORMATS, FORMAT_LABEL, KINDS, KIND_LABEL, KIND_STYLE, PLATFORMS, PLATFORM_LABEL, formatOf, formatsFor, isFormat, isKind, isPlatform, taipeiParts, weekDays, type Platform, type Post, type PostFormat, type PostKind } from "./postLogic";
import type { Project, ProjectLog } from "./projectLogic";
import type { RadarSummary } from "./radarLogic";
import { HOOK_FORMULAS, swipesForPrompt, type Swipe } from "./swipeLogic";

// 每週內容規劃：AI 讀這個專案最近發生的事（工作日誌、話題雷達、點子、靈感庫、最近發過的主題），
// 排出一週 4～5 則的計畫（只有主題、格式、類型、時間）。不存檔，畫面上勾選後才存成草稿。

export type PlanSlot = { date: string; time: string; platform: Platform; format: PostFormat; kind: PostKind; topic: string; source: string; formula: string };
export const MAX_SLOTS = 5;
const WEEKDAY = ["一", "二", "三", "四", "五", "六", "日"];

const SCHEMA = {
  type: "object",
  properties: {
    slots: {
      type: "array",
      description: "這週要發的 4～5 則，照日期排",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD，只能用我列出的日期" },
          time: { type: "string", description: "HH:MM（24 小時制，台北時間）" },
          platform: { type: "string", enum: [...PLATFORMS] },
          format: { type: "string", enum: [...FORMATS] },
          kind: { type: "string", enum: [...KINDS] },
          topic: { type: "string", description: "這則的具體角度，一句話、40 個字以內。是角度不是題目：「隱私」不是，「會不會被同學看到？三個設定一次講完」才是" },
          source: { type: "string", description: "這個角度從哪裡來：哪一天的日誌、哪個痛點、哪個點子，或「這週發生的事」。20 個字以內" },
          formula: { type: "string", enum: [...HOOK_FORMULAS.map((f) => f.key), "other"], description: "建議用哪一種開頭公式" },
        },
        required: ["date", "time", "platform", "format", "kind", "topic", "source", "formula"],
      },
    },
  },
  required: ["slots"],
};

const SYSTEM = [
  "你幫一位台灣的創業者排這一週的社群內容。他會自己看過、挑要的，再一則一則寫文案。",
  "規則：",
  "・排 4～5 則，不要每天都排。至少一半是短影片（reel），因為只有短影片會被沒追蹤的人看到；輪播（carousel）適合有步驟、值得收藏的內容；限時動態（story）不要排進來。",
  `・每則標一個類型，一週裡要混著排，不能連續兩則同一種：\n${KINDS.map((k) => `　${k}＝${KIND_STYLE[k]}`).join("\n")}`,
  "・成果證明、教學各至少一則；介紹產品最多一則。",
  "・每則都要是「角度」不是「題目」，而且要從我給的材料來：這週發生的事、工作日誌、話題雷達的痛點、點子。材料裡沒有的事、數字、使用者故事都不要編；材料不夠就少排幾則。",
  "・工作日誌是內部紀錄，拿來找角度可以，但主題要是能公開講的：不要出現其他產品或競品的名字、內部的做法細節；會讓人覺得「這個產品沒人用」的數字，只有在我自己寫在「這週發生的事」裡才用。",
  "・不要跟「最近發過的」重複主題。",
  "・平台優先用這個專案平常在發的；短影片、輪播只能排在 ig 或 fb_page。",
  "・時間：一般大眾排在晚上 19:00～21:30；對象是上班族或商家可以排早上 7:30～9:00。",
  "・用繁體中文、台灣用語。",
].join("\n");

export type PlanContext = { audit?: string; note: string; logs: ProjectLog[]; radar: RadarSummary | null; ideas: { summary: string | null; next_step: string | null }[]; swipes: Swipe[]; posts: Post[] };

/** 把材料整理成給 AI 的文字（純函式，方便測試） */
export function planPrompt(project: Pick<Project, "name" | "description">, dates: string[], ctx: PlanContext): string {
  const days = dates.map((d) => `${d}（週${WEEKDAY[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}）`).join("、");
  const used = new Map<Platform, number>();
  for (const p of ctx.posts) used.set(p.platform, (used.get(p.platform) ?? 0) + 1);
  const platforms = [...used].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}（${PLATFORM_LABEL[k][0]}，${n} 則）`);
  const recent = ctx.posts.slice(-25).map((p) => `・${taipeiParts(p.due_at).date} ${FORMAT_LABEL[formatOf(p)][0]}${isKind(p.kind) ? `／${KIND_LABEL[p.kind][0]}` : ""}：${(p.topic || p.body.split("\n")[0] || "").slice(0, 60)}`);
  const hooks = swipesForPrompt(ctx.swipes);
  return [
    `專案：${project.name}`,
    `專案的一句話描述：${project.description?.trim() || "（沒有填）"}`,
    `可以排的日期（只能用這些）：${days}`,
    platforms.length ? `這個專案平常發的平台：${platforms.join("、")}` : "這個專案還沒發過貼文，預設排 ig。",
    ctx.note.trim() ? `這週發生的事（我自己寫的，最優先用）：\n${ctx.note.trim().slice(0, 1500)}` : "",
    ctx.logs.length ? `最近 14 天的工作日誌：\n${ctx.logs.slice(0, 40).map((l) => `・${taipeiParts(l.at).date} ${l.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}` : "",
    ctx.radar?.pains.length ? `話題雷達這週看到的痛點（大家在抱怨什麼）：\n${ctx.radar.pains.slice(0, 6).map((p) => `・${p.title}：${p.detail.slice(0, 120)}`).join("\n")}` : "",
    ctx.ideas.length ? `這個專案的點子：\n${ctx.ideas.slice(0, 8).map((i) => `・${(i.summary ?? "").slice(0, 100)}`).join("\n")}` : "",
    hooks ? `同領域最近有效的開頭（挑開頭公式時參考）：\n${hooks}` : "",
    ctx.audit ? `我自己貼文的成效（多排有效的格式與類型，沒效的少排）：\n${ctx.audit}` : "",
    recent.length ? `最近發過和已經排好的（不要重複）：\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** 檢查 AI 回來的計畫：日期要在可排的範圍、格式要是那個平台有的、最多 5 則、照時間排 */
export function cleanPlan(raw: { slots?: unknown }, dates: string[]): PlanSlot[] {
  const list = Array.isArray(raw?.slots) ? (raw.slots as Record<string, unknown>[]) : [];
  const out: PlanSlot[] = [];
  for (const s of list) {
    const date = String(s?.date ?? "");
    const topic = String(s?.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!dates.includes(date) || !topic) continue;
    const platform: Platform = isPlatform(s.platform) ? s.platform : "ig";
    const format: PostFormat = isFormat(s.format) && formatsFor(platform).includes(s.format) ? s.format : "post";
    const formula = HOOK_FORMULAS.some((f) => f.key === s.formula) ? String(s.formula) : "other";
    out.push({ date, time: parseTime(String(s.time ?? "")) ?? DEFAULT_TIME, platform, format, kind: isKind(s.kind) ? s.kind : "teach", topic, source: String(s.source ?? "").trim().slice(0, 60), formula });
  }
  return out.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, MAX_SLOTS);
}

/** 讀材料、請 AI 排這一週。week＝那週的星期一；只排今天以後的日子 */
export async function planWeek(project: Project, week: string, today: string, note: string): Promise<{ slots?: PlanSlot[]; error?: string }> {
  const dates = weekDays(week).filter((d) => d >= today);
  if (!dates.length) return { error: "這一週已經過了，換到本週或下一週再排。" };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [logs, radar, ideas, swipes, posts] = await Promise.all([
    db().from("project_logs").select("*").eq("project_id", project.id).gte("at", since).order("at", { ascending: false }).limit(60),
    db().from("radar_reports").select("summary").eq("project_id", project.id).eq("status", "done").order("created_at", { ascending: false }).limit(1),
    db().from("ideas").select("summary, next_step, score_total").eq("project_id", project.id).order("score_total", { ascending: false, nullsFirst: false }).limit(8),
    db().from("social_swipes").select("*").eq("project_id", project.id).limit(200),
    db().from("project_posts").select("*").eq("project_id", project.id).gte("due_at", new Date(Date.now() - 21 * 86_400_000).toISOString()).order("due_at", { ascending: true }).limit(80),
  ]);
  const ctx: PlanContext = {
    note,
    // 系統自己寫的日誌（例如「話題雷達：看了 30 篇」）不是發生的事，不給 AI
    logs: ((logs.data ?? []) as ProjectLog[]).filter((l) => l.source !== "system"),
    radar: ((radar.data ?? []) as { summary: RadarSummary | null }[])[0]?.summary ?? null,
    ideas: (ideas.data ?? []) as PlanContext["ideas"],
    swipes: (swipes.data ?? []) as Swipe[],
    posts: ((posts.data ?? []) as Post[]).filter((p) => p.status !== "skipped"),
  };
  // 自己已發貼文的成效（沒有數字或還沒執行 migration-032 就是空的）
  const { data: posted } = await db().from("project_posts").select("*").eq("project_id", project.id).eq("status", "posted").order("due_at", { ascending: false }).limit(60);
  ctx.audit = auditForPrompt(auditOf((posted ?? []) as Post[]));
  if (!note.trim() && !ctx.logs.length && !ctx.radar?.pains.length && !ctx.ideas.length && !project.description?.trim()) {
    return { error: "沒有材料可以排：先在上面寫幾句這週發生的事，或到專案設定填一句話描述。" };
  }
  const raw = await callStructured<{ slots?: unknown }>({
    model: env.researchModel(),
    system: SYSTEM,
    content: planPrompt(project, dates, ctx),
    toolName: "week_plan",
    toolDescription: "回報這一週的社群內容計畫",
    schema: SCHEMA,
    maxTokens: 2000,
    purpose: "social_plan",
  });
  const slots = cleanPlan(raw, dates);
  return slots.length ? { slots } : { error: "AI 沒有排出內容，補幾句這週發生的事再試一次。" };
}
