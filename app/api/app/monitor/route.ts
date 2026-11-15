import { monitorData } from "@/lib/app";
import { appJson, withDevice } from "@/lib/appRoute";

// 手機 App 的「監控」分頁（只讀）
export const dynamic = "force-dynamic";

export const GET = withDevice(async () => appJson({ ok: true, ...(await monitorData()) }));
