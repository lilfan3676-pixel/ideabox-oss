import { ideasData } from "@/lib/app";
import { appJson, forbidden, withDevice } from "@/lib/appRoute";
import { can } from "@/lib/accessLogic";

export const dynamic = "force-dynamic";

export const GET = withDevice(async (_req, _device, access) => (can(access, "ideas") ? appJson({ ok: true, ...(await ideasData(access)) }) : forbidden()));
