import "server-only";
import type { ProductBreakdown, ProjectTab, ServerModule } from "./types";
import { serverModules } from "./server";

// 讀模組清單的小工具（核心程式從這裡讀，不直接碰 server.ts）

export function modules(): ServerModule[] {
  return serverModules;
}

export function moduleDefaults(): NonNullable<ServerModule["defaults"]> {
  return Object.assign({}, ...serverModules.map((m) => m.defaults ?? {}));
}

export function tgDestinations() {
  return serverModules.flatMap((m) => (m.telegram ? [m.telegram] : []));
}

/** 各模組的產品分組統計；某個模組出錯就略過它 */
export async function productBreakdowns(): Promise<ProductBreakdown[]> {
  const all = await Promise.all(serverModules.map((m) => (m.breakdowns ? m.breakdowns().catch(() => []) : Promise.resolve([]))));
  return all.flat();
}

/** 各模組要放進早上專案總覽的幾行；某個模組出錯就略過它 */
export async function morningLines(ctx: { now: number; today: string }): Promise<string[]> {
  const all = await Promise.all(serverModules.map((m) => (m.morning ? m.morning(ctx).catch(() => []) : Promise.resolve([]))));
  return all.flat();
}

/** 各模組加在某個專案詳細頁的分頁；某個模組出錯就略過它 */
export async function projectTabs(ctx: Parameters<NonNullable<ServerModule["projectTabs"]>>[0]): Promise<ProjectTab[]> {
  const all = await Promise.all(serverModules.map((m) => (m.projectTabs ? m.projectTabs(ctx).catch(() => []) : Promise.resolve([]))));
  return all.flat();
}
