import "server-only";
import { callClaude, textOf } from "./ai";
import { daysBetween, taipeiDate } from "./dates";
import { CATEGORY_LABEL, db, isDesign, type Category, type Idea } from "./db";
import { getOwnerContext } from "./owner";
import { env } from "./env";
import { upcomingGrants } from "./grants";
import { scoreLine } from "./ideas";
import { esc, sendToOwner } from "./telegram";

/** 組出本週精選內容（HTML）。 */
export async function buildWeeklyDigest(): Promise<string> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await db().from("ideas").select("*").gte("created_at", since).order("created_at", { ascending: false });
  const all = (data ?? []) as Idea[];
  const designs = all.filter((i) => i.status === "analyzed" && isDesign(i.category));
  const ideas = all.filter((i) => !isDesign(i.category));
  const analyzed = ideas.filter((i) => i.status === "analyzed");
  const pending = ideas.filter((i) => i.status === "needs_input" || i.status === "failed");
  const top = [...analyzed].sort((a, b) => (b.score_total ?? 0) - (a.score_total ?? 0)).slice(0, 5);

  const counts = new Map<Category, number>();
  for (const i of analyzed) if (i.category) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  const countLine = [...counts.entries()].map(([c, n]) => `${CATEGORY_LABEL[c]} ${n}`).join("・");

  const lines: string[] = [`📬 <b>本週點子精選</b>（${taipeiDate()}）`];
  if (!ideas.length) {
    lines.push("這週還沒有存點子。下週滑 Threads 看到好東西，記得分享給我！");
  } else {
    lines.push(`本週存了 ${ideas.length} 則${countLine ? `：${countLine}` : ""}`);
    top.forEach((i, n) => {
      lines.push("");
      lines.push(`<b>${n + 1}. ${esc(i.summary)}</b>`);
      lines.push(`${i.category ? CATEGORY_LABEL[i.category] : ""}｜${scoreLine(i)}`);
      if (i.next_step) lines.push(`👉 ${esc(i.next_step)}`);
      if (i.url) lines.push(esc(i.url));
    });
    if (pending.length) lines.push("", `⚠️ 還有 ${pending.length} 則等你補充內容或重新分析，到主控台處理。`);

    const advice = await weeklyAdvice(top).catch(() => "");
    if (advice) lines.push("", `🧭 <b>本週觀察</b>`, esc(advice));
  }

  if (designs.length) {
    const topDesigns = [...designs].sort((a, b) => (b.score_total ?? 0) - (a.score_total ?? 0)).slice(0, 5);
    lines.push("", `🎨 <b>本週設計收藏</b>（${designs.length} 則）`);
    for (const d of topDesigns) {
      const styles = d.design?.styles?.slice(0, 3).join("、");
      lines.push(`・${esc(d.summary)}${styles ? `（${esc(styles)}）` : ""}`);
    }
  }

  const { costDigestLines } = await import("./costs");
  lines.push(...(await costDigestLines().catch(() => [])));

  const grants = await upcomingGrants(30, 5).catch(() => []);
  if (grants.length) {
    const today = taipeiDate();
    lines.push("", "🏦 <b>30 天內截止的補助／競賽</b>");
    for (const g of grants) lines.push(`・${esc(g.name)}（剩 ${daysBetween(today, g.deadline!)} 天）`);
  }

  const app = env.appUrl();
  if (app) lines.push("", `主控台：${esc(app)}`);
  return lines.join("\n");
}

async function weeklyAdvice(top: Idea[]): Promise<string> {
  if (!top.length) return "";
  const context = await getOwnerContext();
  const list = top.map((i, n) => `${n + 1}. ${i.summary}（${i.category}，綜合 ${i.score_total}）`).join("\n");
  const res = await callClaude({
    model: env.analyzeModel(),
    max_tokens: 400,
    system: `你是創業教練，用繁體中文回答，100 字以內，不要條列。產品：${context}`,
    messages: [{ role: "user", content: `這是我這週存的高分點子：\n${list}\n請指出它們的共通趨勢，並建議下週最值得先做的一件事。` }],
  }, 120_000, "weekly_digest");
  return textOf(res);
}

export async function sendWeeklyDigest(): Promise<boolean> {
  const html = await buildWeeklyDigest();
  return (await sendToOwner(html)) !== null;
}
