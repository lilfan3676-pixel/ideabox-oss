import "server-only";
import type { ServerModule } from "./types";
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
