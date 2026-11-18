import { officeData } from "@/lib/app";
import { appJson, forbidden, withDevice } from "@/lib/appRoute";

export const dynamic = "force-dynamic";

// 辦公室只有你看得到
export const GET = withDevice(async (_req, _device, access) => (access.owner ? appJson({ ok: true, ...(await officeData()) }) : forbidden()));
