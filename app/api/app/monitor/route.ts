import { monitorData } from "@/lib/app";
import { appJson, forbidden, withDevice } from "@/lib/appRoute";
import { can } from "@/lib/accessLogic";

// 手機 App 的「監控」分頁（只讀）
export const dynamic = "force-dynamic";

export const GET = withDevice(async (_req, _device, access) => (can(access, "monitor") ? appJson({ ok: true, ...(await monitorData(Date.now(), access)) }) : forbidden()));
