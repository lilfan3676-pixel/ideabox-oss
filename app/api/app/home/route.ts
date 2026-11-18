import { homeData } from "@/lib/app";
import { appJson, withDevice } from "@/lib/appRoute";

export const dynamic = "force-dynamic";

export const GET = withDevice(async (_req, _device, access) => appJson({ ok: true, ...(await homeData(Date.now(), access)) }));
