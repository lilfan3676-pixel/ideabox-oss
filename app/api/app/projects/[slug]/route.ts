import { projectData } from "@/lib/app";
import { appJson, forbidden, withDevice } from "@/lib/appRoute";
import { can } from "@/lib/accessLogic";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return withDevice(async (_req, _device, access) => {
    if (!can(access, "projects")) return forbidden();
    const d = await projectData(decodeURIComponent(slug).toLowerCase(), Date.now(), access);
    return d ? appJson({ ok: true, ...d }) : appJson({ ok: false, error: "not_found" }, 404);
  })(req);
}
