import { removeDevice, savePushToken } from "@/lib/app";
import { appJson, withDevice } from "@/lib/appRoute";

export const dynamic = "force-dynamic";

// App 開了通知後送推送地址來（關掉通知時送 null）
export const POST = withDevice(async (req, device) => {
  const body = (await req.json().catch(() => ({}))) as { push_token?: unknown };
  const ok = await savePushToken(device.id, body.push_token ?? null);
  return ok ? appJson({ ok: true, name: device.name }) : appJson({ ok: false, error: "bad_token" }, 400);
});

// App 裡按「解除配對」
export const DELETE = withDevice(async (_req, device) => {
  await removeDevice(device.id);
  return appJson({ ok: true });
});
