import { projectData } from "@/lib/app";
import { appJson, withDevice } from "@/lib/appRoute";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return withDevice(async () => {
    const d = await projectData(decodeURIComponent(slug).toLowerCase());
    return d ? appJson({ ok: true, ...d }) : appJson({ ok: false, error: "not_found" }, 404);
  })(req);
}
