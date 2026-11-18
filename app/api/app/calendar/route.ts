import { calendarData } from "@/lib/app";
import { appJson, forbidden, withDevice } from "@/lib/appRoute";
import { can } from "@/lib/accessLogic";
import { taipeiDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = withDevice(async (req, _device, access) => {
  if (!can(access, "calendar")) return forbidden();
  const m = new URL(req.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : taipeiDate().slice(0, 7);
  return appJson({ ok: true, ...(await calendarData(month, access)) });
});
