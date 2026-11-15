import "server-only";
import type { ServerModule } from "./types";

// 自己的模組列在這裡（例如 import { myModule } from "@/private/myModule"）。公開版預設沒有任何模組。
export const serverModules: ServerModule[] = [];
