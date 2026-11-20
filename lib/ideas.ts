import "server-only";
import { analyzeIdea } from "./analyze";
import { CATEGORY_LABEL, db, isDesign, type Idea } from "./db";
import { env } from "./env";
import { fetchGithubRepo, formatStars, githubToText } from "./github";
import { downloadImage, loadStoredImage, removeImage, storeImage, type ImageData } from "./images";
import { downloadFile, esc } from "./telegram";
import { fetchPostContent, parseLink } from "./threads";
import { axisLabels } from "./scoring";

export type IngestResult = { idea: Idea; duplicate: boolean };

async function findByKey(key: string): Promise<Idea | null> {
  const { data } = await db().from("ideas").select("*").eq("post_key", key).maybeSingle();
  return (data as Idea) ?? null;
}

function mergeNote(oldNote: string | null, add: string | null | undefined): string | null {
  const a = add?.trim();
  if (!a) return oldNote;
  if (!oldNote) return a;
  if (oldNote.includes(a)) return oldNote;
  return `${oldNote}\n${a}`;
}

/** 存一個連結（Threads、Instagram、GitHub 或其他網站）。重複的連結不會再建一筆；若附了補充說明則合併並重新分析。 */
export async function ingestLink(rawUrl: string, note?: string | null, projectId?: string | null): Promise<IngestResult | null> {
  const link = parseLink(rawUrl);
  if (!link) return null;

  const existing = await findByKey(link.key);
  if (existing) {
    if (note?.trim() && !(existing.note ?? "").includes(note.trim())) {
      const updated = await addNoteAndReanalyze(existing, note);
      return { idea: updated, duplicate: true };
    }
    return { idea: existing, duplicate: true };
  }

  // 讀取內容：GitHub 用官方 API，其他用分享預覽資訊
  let content: string | null = null;
  let author: string | null = link.author;
  let imageUrl: string | null = null;
  let design: Idea["design"] = null;
  if (link.githubRepo) {
    const gh = await fetchGithubRepo(link.githubRepo);
    if (gh) {
      content = githubToText(gh);
      design = { github: gh.info };
    }
    imageUrl = `https://opengraph.githubassets.com/1/${link.githubRepo}`;
  }
  if (!content) {
    const fetched = await fetchPostContent(link, env.threadsAccessToken());
    content = fetched?.content ?? null;
    author = fetched?.author ?? author;
    imageUrl = imageUrl ?? fetched?.imageUrl ?? null;
  }

  // 預覽圖：下載後存到自己的空間（社群平台的圖片網址會過期）
  let image: ImageData | null = null;
  let imagePath: string | null = null;
  if (imageUrl) {
    image = await downloadImage(imageUrl);
    if (image) imagePath = await storeImage(image);
  }

  const { data, error } = await db()
    .from("ideas")
    .insert({
      source: link.isThreads ? "threads" : "link",
      url: link.canonical,
      post_key: link.key,
      author,
      content,
      note: note?.trim() || null,
      image_path: imagePath,
      design,
      status: "pending",
      ...(projectId ? { project_id: projectId } : {}),
    })
    .select()
    .single();

  if (error) {
    // 23505 = 同時送出兩次造成的唯一鍵衝突，當作重複處理
    if ((error as { code?: string }).code === "23505") {
      const dup = await findByKey(link.key);
      if (dup) return { idea: dup, duplicate: true };
    }
    throw error;
  }
  const idea = await analyzeIdea(data as Idea, image ?? undefined, link.githubRepo ? { forceCategory: "github" } : {});
  return { idea, duplicate: false };
}

export async function ingestText(text: string, projectId?: string | null): Promise<Idea> {
  const { data, error } = await db()
    .from("ideas")
    .insert({ source: "text", content: text.trim().slice(0, 6000), status: "pending", ...(projectId ? { project_id: projectId } : {}) })
    .select()
    .single();
  if (error) throw error;
  return analyzeIdea(data as Idea);
}

export async function ingestPhoto(fileId: string, caption?: string | null): Promise<Idea> {
  const image = await downloadFile(fileId);
  const imagePath = image ? await storeImage(image) : null;
  const { data, error } = await db()
    .from("ideas")
    .insert({ source: "photo", note: caption?.trim() || null, telegram_file_id: fileId, image_path: imagePath, status: "pending" })
    .select()
    .single();
  if (error) throw error;
  return analyzeIdea(data as Idea, image ?? undefined);
}

/** 把截圖補到既有的點子（例如連結讀不到內容時），取代原本的預覽圖 */
export async function attachPhoto(idea: Idea, fileId: string): Promise<Idea> {
  const image = await downloadFile(fileId);
  if (!image) return idea;
  const path = await storeImage(image);
  if (!path) return idea;
  const old = idea.image_path;
  const { data, error } = await db().from("ideas").update({ image_path: path, telegram_file_id: fileId }).eq("id", idea.id).select().single();
  if (error) return idea;
  if (old) await removeImage(old);
  return data as Idea;
}

export async function addNoteAndReanalyze(idea: Idea, note: string): Promise<Idea> {
  const merged = mergeNote(idea.note, note);
  const { data, error } = await db().from("ideas").update({ note: merged }).eq("id", idea.id).select().single();
  if (error) throw error;
  const out = await reanalyze(data as Idea);
  // 補充備註也是一種修正：記下來給 AI 學習
  const { recordSignal, ideaSnapshot, maybeLearn } = await import("./learning");
  await recordSignal("idea", "note", out.id, { ...ideaSnapshot(out), added_note: note.trim().slice(0, 300) });
  try {
    const { after } = await import("next/server");
    after(maybeLearn); // 不拖慢回覆；沒有請求範圍（例如測試）時略過
  } catch {
    // 忽略
  }
  return out;
}

/** 重新分析：有存圖就一起給 AI 看；舊的截圖點子從 Telegram 重新下載。 */
export async function reanalyze(idea: Idea, opts: { keepFiling?: boolean } = {}): Promise<Idea> {
  let image: ImageData | undefined;
  if (idea.image_path) image = (await loadStoredImage(idea.image_path)) ?? undefined;
  if (!image && idea.source === "photo" && idea.telegram_file_id) {
    image = (await downloadFile(idea.telegram_file_id)) ?? undefined;
  }
  const isGithub = idea.post_key?.startsWith("github:");
  if (opts.keepFiling) return analyzeIdea(idea, image, { forceCategory: isGithub ? "github" : (idea.category ?? undefined), keepFiling: true });
  return analyzeIdea(idea, image, isGithub ? { forceCategory: "github" } : {});
}

/** 三項分數一行。後兩項的名稱跟著評分角度換（行銷＝好執行／預期成效…）；舊算法評的沿用「可行／市場」 */
export function scoreLine(i: Pick<Idea, "score_arx" | "score_feasibility" | "score_market" | "score_total" | "category"> & Pick<Partial<Idea>, "scoring">, projectName?: string | null): string {
  if (isDesign(i.category)) {
    return `可套用 ${i.score_arx ?? "-"}／好實作 ${i.score_feasibility ?? "-"}／參考價值 ${i.score_market ?? "-"}（綜合 ${i.score_total ?? "-"}）`;
  }
  const ax = axisLabels(i.scoring?.lens ?? null);
  return `${projectName ? esc(projectName) : "相關"} ${i.score_arx ?? "-"}／${ax.ease} ${i.score_feasibility ?? "-"}／${ax.value} ${i.score_market ?? "-"}（綜合 ${i.score_total ?? "-"}）`;
}

/** Bot 收到點子後的回覆內容（HTML）。 */
export function formatIdeaReply(idea: Idea, duplicate = false, folderName?: string, projectName?: string | null): string {
  if (idea.status === "needs_input") {
    return [
      duplicate ? "🔁 這則之前存過了，但還沒有內容。" : "⚠️ 讀不到這則貼文的內容，已先存下連結。",
      "直接<b>回覆這則訊息</b>補一句重點，或傳一張截圖，我就會幫你分析。",
    ].join("\n");
  }
  if (idea.status === "failed") {
    return "😵 已存下，但 AI 分析暫時失敗，系統會在今晚自動重試；也可以到主控台按「重新分析」。";
  }
  // 有資料夾就顯示資料夾（還沒執行 migration-010 時顯示分類）
  const cat = folderName ?? (idea.category ? CATEGORY_LABEL[idea.category] : "未分類");
  const dupLine = idea.dup_of && !duplicate ? "⚠️ 可能跟之前存的一則重複，到點子庫可以刪掉或標記「不是重複」。" : "";
  if (isDesign(idea.category)) {
    const d = idea.design ?? {};
    const gh = d.github;
    return [
      `${duplicate ? "🔁 之前存過了：" : "🎨 已存入點子庫"}【${esc(cat)}】`,
      esc(idea.summary),
      gh ? `⭐ ${formatStars(gh.stars)}${gh.language ? `・${esc(gh.language)}` : ""}${gh.license ? `・${esc(gh.license)}` : ""}` : "",
      d.styles?.length ? `風格：${d.styles.map(esc).join("、")}` : "",
      ...(d.learn ?? []).slice(0, 3).map((l) => `・${esc(l)}`),
      d.apply ? `👉 ${esc(d.apply)}` : "",
      dupLine,
    ]
      .filter(Boolean)
      .join("\n");
  }
  const head = duplicate ? "🔁 之前存過了：" : "✅ 已存入點子庫";
  return [`${head}【${esc(cat)}】`, esc(idea.summary), scoreLine(idea, projectName), idea.next_step ? `👉 ${esc(idea.next_step)}` : "", dupLine]
    .filter(Boolean)
    .join("\n");
}
