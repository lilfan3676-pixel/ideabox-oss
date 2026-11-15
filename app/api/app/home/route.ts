import { homeData } from "@/lib/app";
import { appJson, withDevice } from "@/lib/appRoute";

export const dynamic = "force-dynamic";

export const GET = withDevice(async () => appJson({ ok: true, ...(await homeData()) }));
