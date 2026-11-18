import "server-only";
import { callStructured } from "./ai";
import { db } from "./db";
import { env } from "./env";
import { cleanHostId, folderName, handoffTargets, isHandoffTool, isRole, maskSecrets, matchProject, revives, KEEP_DAYS, ROLES, statusFor, visibleSessions, worthSummarizing, type AgentSession, type Handoff, type HookPayload } from "./officeLogic";
import { listProjects } from "./projects";

// 辦公室：每個執行中的 Claude Code 是一個小人。Claude Code 的 hook 把事件 POST 到 /api/claude/hook，
// 這裡記狀態；你交代的事由 AI 濃縮成「職位＋一句話」，原文不存。還沒執行 migration-014 時讀取回傳 ready=false。

export async function listOffice(now = Date.now()): Promise<{ sessions: AgentSession[]; handoffs: Handoff[]; ready: boolean }> {
  const since = new Date(now - KEEP_DAYS * 86_400_000).toISOString();
  const [{ data, error }, h] = await Promise.all([
    db().from("agent_sessions").select("*").gte("updated_at", since).order("started_at", { ascending: true }),
    db().from("agent_handoffs").select("id, from_session, to_host, title, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(50),
  ]);
  if (error) return { sessions: [], handoffs: [], ready: false };
  const sessions = visibleSessions((data ?? []) as AgentSession[], now);
  // 還沒執行 migration-024 就沒有交接紀錄（其他照常）
  const byHost = new Map(sessions.filter((s) => s.host_id).map((s) => [s.host_id!, s.session_id]));
  const handoffs: Handoff[] = h.error
    ? []
    : ((h.data ?? []) as { id: string; from_session: string; to_host: string; title: string | null; created_at: string }[]).map((r) => ({
        id: r.id,
        from: r.from_session,
        to: byHost.get(r.to_host) ?? null,
        title: r.title,
        created_at: r.created_at,
      }));
  return { sessions, handoffs, ready: true };
}

/** 交接：記下這個工作階段在桌面 App 的編號；開了新工作階段就記一筆「誰交給誰」。還沒執行 migration-024 就安靜略過 */
async function recordHandoff(p: HookPayload, id: string, host: string | null, prevHost: string | null | undefined) {
  if (host && prevHost !== host) await db().from("agent_sessions").update({ host_id: host }).eq("session_id", id);
  if (p.hook_event_name !== "PostToolUse" || !isHandoffTool(p.tool_name)) return;
  const targets = handoffTargets(p.tool_response, host);
  if (!targets.length) return; // 只是提議、還沒真的開（或你選了「在這裡做」）
  const raw = p.tool_input?.title;
  const title = typeof raw === "string" && raw.trim() ? maskSecrets(raw.trim()).slice(0, 60) : null;
  await db()
    .from("agent_handoffs")
    .upsert(targets.map((to_host) => ({ from_session: id, to_host, title })), { onConflict: "from_session,to_host", ignoreDuplicates: true });
}

type Summary = { role: string; task: string };

async function summarize(prompt: string, projectName: string | null, prevRole: string | null, locked: boolean): Promise<Summary | null> {
  const r = await callStructured<Summary>({
    model: env.analyzeModel(),
    system: [
      "創業家交代一件事給 AI 助理。請判斷這件事最像哪個職位在做，並把要做的事濃縮成一句話，顯示在像素辦公室小人頭上的泡泡裡。",
      "職位看「工作本身是什麼性質」，不是看內容提到什麼：擬合約、條款、隱私權政策、商標、授權 → 法律顧問（就算合約是關於設計）；記帳、報價、成本、稅、預算 → 財務會計；貼文、廣告、宣傳活動 → 行銷社群；聯絡合作對象、寫邀請信、申請文件、行政流程 → 業務營運；畫圖、做介面、設計稿 → 設計師；寫程式才選工程師類。",
      projectName ? `專案：${projectName}` : "",
      locked && prevRole
        ? `這位助理的職位是創業家指定的「${prevRole}」，role 一律回傳「${prevRole}」。`
        : prevRole
          ? `這位助理目前的職位是「${prevRole}」，除非這次工作性質明顯不同，否則沿用。`
          : "",
      "task 用繁體中文、動詞開頭、15 字以內，例如「修地圖火焰動畫」「寫上架說明文案」。不要包含任何金鑰、密碼、網址或個資。",
    ]
      .filter(Boolean)
      .join("\n"),
    content: maskSecrets(prompt).slice(0, 2000),
    toolName: "save_task",
    toolDescription: "儲存職位與一句話任務",
    schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: [...ROLES] },
        task: { type: "string", description: "15 字以內" },
      },
      required: ["role", "task"],
    },
    maxTokens: 200,
    purpose: "office_task",
  });
  if (!isRole(r.role)) return null;
  return { role: r.role, task: maskSecrets(String(r.task ?? "").trim()).slice(0, 30) };
}

/** 處理一個 hook 事件。回傳要不要在背景做 AI 摘要（給 route 用 after() 跑） */
export async function recordHook(p: HookPayload, hostHeader?: string | null): Promise<(() => Promise<void>) | null> {
  const id = String(p.session_id ?? "").slice(0, 100);
  if (!id) return null;
  const host = cleanHostId(hostHeader);
  const status = statusFor(p);
  const now = new Date().toISOString();

  const { data: existing } = await db().from("agent_sessions").select("*").eq("session_id", id).maybeSingle();
  const prev = existing as AgentSession | null;

  if (!prev) {
    const { projects } = await listProjects();
    const cwd = String(p.cwd ?? "");
    await db().from("agent_sessions").insert({
      session_id: id,
      project_id: matchProject(cwd, projects),
      folder: folderName(cwd) || null,
      status: status ?? "idle",
      started_at: now,
      updated_at: now,
      ended_at: status === "ended" ? now : null,
    });
  } else if (status) {
    if (prev.status === "ended" && !revives(p)) return null;
    const patch: Partial<AgentSession> = { status, updated_at: now, ended_at: status === "ended" ? now : null };
    // 還在大廳的：每次回報都重新對一次專案（例如你剛在專案設定改了資料夾名稱，小人就會搬進房間）
    if (!prev.project_id && p.cwd) {
      const { projects } = await listProjects();
      const pid = matchProject(String(p.cwd), projects);
      if (pid) patch.project_id = pid;
    }
    await db().from("agent_sessions").update(patch).eq("session_id", id);
  } else {
    return null;
  }
  await recordHandoff(p, id, host, prev?.host_id).catch(() => null);

  // 有交代新的事才請 AI 判斷職位與任務（在背景做，不拖慢 Claude Code）
  const prompt = String(p.prompt ?? "");
  if (p.hook_event_name !== "UserPromptSubmit" || !worthSummarizing(prompt)) return null;
  return async () => {
    const { data } = await db().from("agent_sessions").select("*").eq("session_id", id).maybeSingle();
    const s = data as AgentSession | null;
    if (!s) return;
    let projectName: string | null = null;
    if (s.project_id) {
      const { data: pr } = await db().from("projects").select("name").eq("id", s.project_id).maybeSingle();
      projectName = (pr as { name: string } | null)?.name ?? null;
    }
    const locked = !!s.role_locked && !!s.role;
    const sum = await summarize(prompt, projectName, s.role, locked);
    if (sum) await db().from("agent_sessions").update(locked ? { task: sum.task } : { role: sum.role, task: sum.task }).eq("session_id", id);
  };
}

/** 手動請他下班（例如 Claude 已經關掉但沒回報） */
export async function endSession(id: string) {
  await db().from("agent_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("session_id", String(id).slice(0, 100));
}

/** 在辦公室清單上手動指定職位；之後 AI 只更新任務。還沒執行 migration-018 就只改職位（下次交代事情時 AI 可能又改掉） */
export async function setSessionRole(id: string, role: string): Promise<{ ok: boolean; locked: boolean }> {
  if (!isRole(role)) return { ok: false, locked: false };
  const sid = String(id).slice(0, 100);
  const { error } = await db().from("agent_sessions").update({ role, role_locked: true }).eq("session_id", sid);
  if (!error) return { ok: true, locked: true };
  const r = await db().from("agent_sessions").update({ role }).eq("session_id", sid);
  return { ok: !r.error, locked: false };
}

/** 每日排程：清掉 7 天前結束或沒動靜的紀錄 */
export async function cleanupSessions() {
  const before = new Date(Date.now() - 7 * 86_400_000).toISOString();
  await db().from("agent_sessions").delete().lt("updated_at", before);
}
