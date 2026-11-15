import "server-only";
import type { GithubInfo } from "./db";
import { env } from "./env";
import { fetchWithTimeout } from "./threads";

// 讀取 GitHub 專案資訊與 README（公開 API；有設定 GITHUB_TOKEN 時額度較高）

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": "ideabox", Accept: "application/vnd.github+json", ...extra };
  const token = env.githubToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export type GithubFetch = { info: GithubInfo; readme: string | null };

export async function fetchGithubRepo(repo: string): Promise<GithubFetch | null> {
  const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}`, { headers: headers() }, 8000);
  if (!res || !res.ok) return null;
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j || typeof j.full_name !== "string") return null;
  const license = (j.license as { spdx_id?: string; name?: string } | null) ?? null;
  const info: GithubInfo = {
    repo: j.full_name,
    description: (j.description as string | null) ?? null,
    stars: typeof j.stargazers_count === "number" ? j.stargazers_count : undefined,
    language: (j.language as string | null) ?? null,
    license: license?.spdx_id && license.spdx_id !== "NOASSERTION" ? license.spdx_id : (license?.name ?? null),
    pushed_at: (j.pushed_at as string | null) ?? null,
    topics: Array.isArray(j.topics) ? (j.topics as string[]).slice(0, 8) : [],
    homepage: (j.homepage as string | null) || null,
  };
  let readme: string | null = null;
  const r = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/readme`,
    { headers: headers({ Accept: "application/vnd.github.raw" }) },
    8000,
  );
  if (r && r.ok) readme = (await r.text()).slice(0, 8000);
  return { info, readme };
}

/** 把 GitHub 資訊整理成給 AI 讀的文字 */
export function githubToText(g: GithubFetch): string {
  const i = g.info;
  return [
    `GitHub 專案：${i.repo}`,
    i.description ? `簡介：${i.description}` : "",
    i.stars !== undefined ? `星星數：${i.stars}` : "",
    i.language ? `主要語言：${i.language}` : "",
    i.topics?.length ? `主題標籤：${i.topics.join(", ")}` : "",
    g.readme ? `README（節錄）：\n${g.readme.slice(0, 5000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export { formatStars, timeAgo } from "./format";
