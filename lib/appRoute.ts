import "server-only";
// 手機 App API 共用：驗證裝置、統一回傳格式（一律不快取）
import { NextResponse } from "next/server";
import { deviceAccess, deviceFromRequest, type AppDevice } from "./app";
import type { Access } from "./accessLogic";

const NO_STORE = { "Cache-Control": "no-store" };

export function appJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** 合夥人沒有這個分頁的權限 */
export const forbidden = () => appJson({ ok: false, error: "forbidden" }, 403);

/** 包一層：沒配對（或在網頁上被解除、合夥人被停用）回 401，App 會回到配對畫面 */
export function withDevice(handler: (req: Request, device: AppDevice, access: Access) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const device = await deviceFromRequest(req);
      const access = device ? await deviceAccess(device) : null;
      if (!device || !access) return appJson({ ok: false, error: "unpaired" }, 401);
      return await handler(req, device, access);
    } catch (err) {
      console.error("app api", err);
      return appJson({ ok: false, error: "server" }, 500);
    }
  };
}
