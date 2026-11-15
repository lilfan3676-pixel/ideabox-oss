// 呼叫 ideabox 的 /api/app/*：自動帶登入憑證；被解除配對（401）就清掉回到配對畫面
import { getSession, saveSession, type Session } from "./session";

export class ApiError extends Error {
  constructor(public code: "unpaired" | "network" | "server" | "bad_code" | "not_found", message: string) {
    super(message);
  }
}

const MESSAGES: Record<ApiError["code"], string> = {
  unpaired: "這支手機已經被解除配對，請重新配對。",
  network: "連不上 ideabox，請檢查網路。",
  server: "ideabox 出了點問題，等一下再試。",
  bad_code: "配對碼不對或已經失效，請在網頁設定頁重新產生。",
  not_found: "找不到這筆資料。",
};

async function request<T>(session: Session, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${session.server}${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${session.token}`, ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("network", MESSAGES.network);
  }
  if (res.status === 401) {
    await saveSession(null);
    throw new ApiError("unpaired", MESSAGES.unpaired);
  }
  if (res.status === 404) throw new ApiError("not_found", MESSAGES.not_found);
  if (!res.ok) throw new ApiError("server", MESSAGES.server);
  return (await res.json()) as T;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const s = getSession();
  if (!s) throw new ApiError("unpaired", MESSAGES.unpaired);
  return request<T>(s, path, init);
}

/** 配對：成功就存起來，失敗丟出中文說明 */
export async function pair(server: string, code: string, name: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${server}/api/app/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code, name }),
    });
  } catch {
    throw new ApiError("network", "連不上這個網址，請確認有打對。");
  }
  if (res.status === 400) throw new ApiError("bad_code", MESSAGES.bad_code);
  if (res.status === 500) throw new ApiError("server", "ideabox 沒辦法配對，請確認已執行 migration-022-app.sql。");
  if (!res.ok) throw new ApiError("server", "這個網址好像不是 ideabox，請確認有打對。");
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!body.token) throw new ApiError("server", MESSAGES.server);
  await saveSession({ server, token: body.token });
}

export async function unpair(): Promise<void> {
  await api("/api/app/device", { method: "DELETE" }).catch(() => null);
  await saveSession(null);
}
