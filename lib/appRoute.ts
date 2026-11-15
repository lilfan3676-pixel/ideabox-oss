import "server-only";
// 手機 App API 共用：驗證裝置、統一回傳格式（一律不快取）
import { NextResponse } from "next/server";
import { deviceFromRequest, type AppDevice } from "./app";

const NO_STORE = { "Cache-Control": "no-store" };

export function appJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** 包一層：沒配對（或在網頁上被解除）回 401，App 會回到配對畫面 */
export function withDevice(handler: (req: Request, device: AppDevice) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const device = await deviceFromRequest(req);
      if (!device) return appJson({ ok: false, error: "unpaired" }, 401);
      return await handler(req, device);
    } catch (err) {
      console.error("app api", err);
      return appJson({ ok: false, error: "server" }, 500);
    }
  };
}
