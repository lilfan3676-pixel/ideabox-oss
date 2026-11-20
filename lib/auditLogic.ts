// 成效檢討的判斷邏輯（純函式）。重點：觀看數是最沒用的數字（主要看你有多少追蹤），
// 所以排名看「是你自己平常的幾倍」和「每 1000 次觸及帶來幾次分享」。樣本少就只列數字、不下結論。
import { formatOf, isKind, postTitle, taipeiParts, type Post, type PostFormat, type PostKind } from "./postLogic";
import { parseCount } from "./swipeLogic";

export const METRIC_KEYS = ["views", "reach", "likes", "comments", "shares", "saves", "follows", "nonfollower"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number>>;
export const METRIC_LABEL: Record<MetricKey, [string, string]> = {
  views: ["觀看", "Views"],
  reach: ["觸及", "Reach"],
  likes: ["讚", "Likes"],
  comments: ["留言", "Comments"],
  shares: ["分享", "Shares"],
  saves: ["收藏", "Saves"],
  follows: ["新追蹤", "Follows"],
  nonfollower: ["非追蹤者 %", "Non-followers %"],
};

/** 整理輸入：數字可以寫「2.6萬」「18k」；非追蹤者是 0～100 的百分比；空的不存 */
export function cleanMetrics(input: unknown): Metrics {
  const out: Metrics = {};
  if (!input || typeof input !== "object") return out;
  for (const k of METRIC_KEYS) {
    const raw = (input as Record<string, unknown>)[k];
    const n = parseCount(typeof raw === "string" ? raw.replace(/%/g, "") : raw);
    if (n === null) continue;
    if (k === "nonfollower" && n > 100) continue;
    out[k] = n;
  }
  return out;
}

export const metricsOf = (p: Pick<Post, "metrics">): Metrics => cleanMetrics(p.metrics ?? null);
export const hasMetrics = (p: Pick<Post, "metrics">) => Object.keys(metricsOf(p)).length > 0;

export function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

export type AuditRow = {
  id: string;
  date: string;
  title: string;
  format: PostFormat;
  kind: PostKind | null;
  m: Metrics;
  /** 是自己平常（中位數）的幾倍 */
  multiple: number | null;
  /** 每 1000 次觸及帶來幾次分享（沒有觸及就用觀看） */
  sharesPerK: number | null;
  followsPerK: number | null;
};
export type AuditGroup<K extends string> = { key: K; n: number; multiple: number | null; sharesPerK: number | null };
export type Audit = {
  rows: AuditRow[];
  /** 已發、還沒填數字的 */
  missing: { id: string; date: string; title: string }[];
  medianViews: number | null;
  sharesPerK: number | null;
  followsPerK: number | null;
  byFormat: AuditGroup<PostFormat>[];
  byKind: AuditGroup<PostKind>[];
};

const perK = (num: number | undefined, m: Metrics): number | null => {
  const base = m.reach ?? m.views;
  return num === undefined || !base ? null : round1((num / base) * 1000);
};
const total = (rows: AuditRow[], key: "shares" | "follows"): number | null => {
  const use = rows.filter((r) => r.m[key] !== undefined && (r.m.reach ?? r.m.views));
  const base = use.reduce((s, r) => s + (r.m.reach ?? r.m.views ?? 0), 0);
  return base ? round1((use.reduce((s, r) => s + (r.m[key] ?? 0), 0) / base) * 1000) : null;
};
function groups<K extends string>(rows: AuditRow[], keyOf: (r: AuditRow) => K | null): AuditGroup<K>[] {
  const map = new Map<K, AuditRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k) map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map].map(([key, list]) => ({ key, n: list.length, multiple: (() => { const md = median(list.flatMap((r) => (r.multiple === null ? [] : [r.multiple]))); return md === null ? null : round1(md); })(), sharesPerK: total(list, "shares") })).sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1));
}

/** 把已發的貼文整理成成效表：倍數高的在前，沒有觀看數的排最後 */
export function auditOf(posts: Post[]): Audit {
  const posted = posts.filter((p) => p.status === "posted");
  const withM = posted.filter(hasMetrics);
  const medianViews = median(withM.flatMap((p) => (metricsOf(p).views ? [metricsOf(p).views!] : [])));
  const rows: AuditRow[] = withM
    .map((p) => {
      const m = metricsOf(p);
      return { id: p.id, date: taipeiParts(p.due_at).date, title: postTitle(p) || p.target, format: formatOf(p), kind: isKind(p.kind) ? p.kind : null, m, multiple: m.views && medianViews ? round1(m.views / medianViews) : null, sharesPerK: perK(m.shares, m), followsPerK: perK(m.follows, m) };
    })
    .sort((a, b) => (b.multiple ?? -1) - (a.multiple ?? -1) || b.date.localeCompare(a.date));
  return {
    rows,
    missing: posted.filter((p) => !hasMetrics(p)).map((p) => ({ id: p.id, date: taipeiParts(p.due_at).date, title: postTitle(p) || p.target })).sort((a, b) => b.date.localeCompare(a.date)),
    medianViews: medianViews === null ? null : Math.round(medianViews),
    sharesPerK: total(rows, "shares"),
    followsPerK: total(rows, "follows"),
    byFormat: groups(rows, (r) => r.format),
    byKind: groups(rows, (r) => r.kind),
  };
}

/** 少於這個數量只列數字、不下結論 */
export const MIN_SAMPLE = 6;
export type Finding = { key: string; text: [string, string] };
const FMT: Record<PostFormat, string> = { post: "貼文", reel: "Reel", carousel: "輪播", story: "限動" };
const KIND: Record<PostKind, string> = { proof: "成果證明", teach: "教學", opinion: "觀點", story: "故事", offer: "介紹產品" };

/** 程式自己看得出來的幾件事（保守：每組至少 2 則、差距夠大才講） */
export function findings(a: Audit): Finding[] {
  const n = a.rows.filter((r) => r.multiple !== null).length;
  if (n < MIN_SAMPLE) return [];
  const out: Finding[] = [];
  const f = a.byFormat.filter((g) => g.n >= 2 && g.multiple !== null);
  if (f.length >= 2) {
    const best = f[0];
    const worst = f[f.length - 1];
    if (best.multiple! >= worst.multiple! * 1.5 && best.multiple! - worst.multiple! >= 0.5) {
      out.push({ key: "format", text: [`${FMT[best.key]}的中位數是你平常的 ${best.multiple} 倍，${FMT[worst.key]} ${worst.multiple} 倍（各 ${best.n} 則、${worst.n} 則）。`, `${best.key} posts run at a median ${best.multiple}x your usual views; ${worst.key} at ${worst.multiple}x (${best.n} and ${worst.n} posts).`] });
    }
  }
  const k = a.byKind.filter((g) => g.n >= 2 && g.sharesPerK !== null).sort((x, y) => y.sharesPerK! - x.sharesPerK!);
  if (k.length >= 2 && k[0].sharesPerK! >= 1 && k[0].sharesPerK! >= k[1].sharesPerK! * 2) {
    out.push({ key: "kind-share", text: [`「${KIND[k[0].key]}」類的分享率最高：每 1000 次觸及 ${k[0].sharesPerK} 次，第二名「${KIND[k[1].key]}」${k[1].sharesPerK} 次。分享是最強的訊號。`, `“${k[0].key}” posts get shared most: ${k[0].sharesPerK} per 1,000 reach vs ${k[1].sharesPerK} for “${k[1].key}”.`] });
  }
  const km = a.byKind.filter((g) => g.n >= 2 && g.multiple !== null);
  if (km.length >= 2 && km[0].multiple! >= km[km.length - 1].multiple! * 2) {
    out.push({ key: "kind", text: [`「${KIND[km[0].key]}」類的中位數 ${km[0].multiple} 倍，「${KIND[km[km.length - 1].key]}」${km[km.length - 1].multiple} 倍。`, `“${km[0].key}” posts have a median of ${km[0].multiple}x; “${km[km.length - 1].key}” ${km[km.length - 1].multiple}x.`] });
  }
  const leak = a.rows.filter((r) => (r.multiple ?? 0) >= 2 && r.followsPerK !== null && r.followsPerK < 0.5);
  if (leak.length) out.push({ key: "profile", text: [`有 ${leak.length} 則觀看是平常的 2 倍以上，卻幾乎沒帶來追蹤。有人看、沒人追蹤，問題通常在個人檔案（簡介、置頂貼文），不在貼文本身。`, `${leak.length} post(s) hit 2x your usual views but brought almost no follows. That usually points at the profile, not the post.`] });
  const nf = a.rows.filter((r) => r.m.nonfollower !== undefined);
  if (nf.length >= 4) {
    const md = median(nf.map((r) => r.m.nonfollower!))!;
    if (md < 20) out.push({ key: "reach", text: [`非追蹤者的比例中位數只有 ${Math.round(md)}%，貼文幾乎沒有傳到追蹤者以外的人。短影片是最容易傳出去的格式。`, `A median of only ${Math.round(md)}% of reach is non-followers, so posts barely travel beyond your followers.`] });
  }
  return out;
}

/** 給 AI 看的成效摘要（排這週、解讀成效都用這份）：最好的 3 則、最差的 3 則、各格式與類型 */
export function auditForPrompt(a: Audit): string {
  const ranked = a.rows.filter((r) => r.multiple !== null);
  if (ranked.length < 3) return "";
  const line = (r: AuditRow) => `・${r.multiple} 倍｜${FMT[r.format]}${r.kind ? `／${KIND[r.kind]}` : ""}｜${r.title.slice(0, 50)}｜觀看 ${r.m.views}${r.sharesPerK !== null ? `、每千觸及分享 ${r.sharesPerK}` : ""}${r.followsPerK !== null ? `、追蹤 ${r.followsPerK}` : ""}`;
  const worst = ranked.slice(-3).filter((r) => !ranked.slice(0, 3).includes(r));
  return [
    `有數字的貼文 ${ranked.length} 則，平常的觀看（中位數）${a.medianViews}。`,
    `表現最好的：\n${ranked.slice(0, 3).map(line).join("\n")}`,
    worst.length ? `表現最差的：\n${worst.map(line).join("\n")}` : "",
    a.byFormat.length > 1 ? `各格式的中位數倍數：${a.byFormat.map((g) => `${FMT[g.key]} ${g.multiple ?? "—"}（${g.n} 則）`).join("、")}` : "",
    a.byKind.length > 1 ? `各類型的中位數倍數：${a.byKind.map((g) => `${KIND[g.key]} ${g.multiple ?? "—"}（${g.n} 則）`).join("、")}` : "",
  ].filter(Boolean).join("\n");
}
