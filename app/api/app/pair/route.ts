import { deviceAccess, redeemPairCode } from "@/lib/app";
import { appTabs } from "@/lib/accessLogic";
import { appJson } from "@/lib/appRoute";

// App 送來配對碼（掃 QR code 或手打），對了就回傳這台手機專用的登入憑證
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
  try {
    const r = await redeemPairCode(body.code, body.name);
    if (!r) return appJson({ ok: false, error: "bad_code" }, 400);
    // 分頁一配對就知道（合夥人的手機只顯示他有權限的分頁）
    const access = await deviceAccess({ id: r.deviceId, name: "", push_token: null, created_at: "", last_seen_at: "", member_id: r.memberId });
    return appJson({ ok: true, token: r.token, device_id: r.deviceId, tabs: access ? appTabs(access) : ["today"] });
  } catch (err) {
    console.error("app pair", err);
    // 最常見：還沒執行 migration-022
    return appJson({ ok: false, error: "server" }, 500);
  }
}
