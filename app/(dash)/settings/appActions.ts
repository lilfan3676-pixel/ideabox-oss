"use server";
// 設定頁「手機 App」：產生配對 QR code、解除配對
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { requireOwner } from "@/lib/auth";
import { createPairCode, removeDevice } from "@/lib/app";
import { env } from "@/lib/env";

export type PairResult = { ok: true; code: string; expiresAt: number; svg: string; server: string } | { ok: false; error: string };

async function serverUrl(): Promise<string> {
  const fixed = env.appUrl().replace(/\/+$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createAppPairing(): Promise<PairResult> {
  await requireOwner();
  try {
    const { code, expiresAt } = await createPairCode();
    const server = await serverUrl();
    // App 掃到（或 iPhone 相機掃到）就會打開 ideabox App 完成配對
    const link = `ideabox://pair?server=${encodeURIComponent(server)}&code=${code}`;
    const svg = await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
    return { ok: true, code, expiresAt, svg, server };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 160) };
  }
}

export async function removeAppDevice(id: string): Promise<void> {
  await requireOwner();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await removeDevice(id);
  revalidatePath("/settings");
}
