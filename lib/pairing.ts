import "server-only";
// 產生手機 App 配對用的 QR code（設定頁的「手機 App」、合夥人頁、合夥人自己的「我的帳號」共用）
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createPairCode } from "./app";
import { env } from "./env";

export type PairResult = { ok: true; code: string; expiresAt: number; svg: string; server: string } | { ok: false; error: string };

async function serverUrl(): Promise<string> {
  const fixed = env.appUrl().replace(/\/+$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** memberId：合夥人的手機（只看得到他有權限的東西）；null＝主人的手機 */
export async function makePairing(memberId: string | null): Promise<PairResult> {
  try {
    const { code, expiresAt } = await createPairCode(Date.now(), memberId);
    const server = await serverUrl();
    // App 掃到（或 iPhone 相機掃到）就會打開 ideabox App 完成配對
    const link = `ideabox://pair?server=${encodeURIComponent(server)}&code=${code}`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
    return { ok: true, code, expiresAt, svg, server };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 160) };
  }
}
