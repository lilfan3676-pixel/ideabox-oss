// 辦公室：Claude Code hook → 小人狀態、職位與任務摘要；專案詳細頁的階段歷程
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import { displayStatus, folderName, maskSecrets, matchProject, onDuty, staffOf, statusFor, visibleSessions, type AgentSession } from "@/lib/officeLogic";
import { stageSegments } from "@/lib/projectLogic";

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => fakeDb };
});
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => Promise<unknown>) => pending.push(fn()) };
});

process.env.ANTHROPIC_API_KEY = "k";
process.env.CLAUDE_HOOK_SECRET = "hook-secret";

const FIT_ID = "11111111-1111-1111-1111-111111111111";
const projects = [
  { id: FIT_ID, folder: "Fit", status: "active" as const },
  { id: "22222222-2222-2222-2222-222222222222", folder: "my-dating-app", status: "active" as const },
];

describe("辦公室規則", () => {
  it("資料夾對應專案：任一層、不分大小寫、worktree 也對得到；對不到 = 大廳", () => {
    expect(matchProject("/Users/me/ai/Fit", projects)).toBe(FIT_ID);
    expect(matchProject("/Users/me/ai/fit/.claude/worktrees/fix-map", projects)).toBe(FIT_ID);
    expect(matchProject("/Users/me/my-dating-app/web", projects)).toBe(projects[1].id);
    expect(matchProject("/Users/me/ideabox", projects)).toBeNull();
    expect(folderName("/Users/me/ideabox")).toBe("ideabox");
    expect(folderName("/Users/me/ideabox/.claude/worktrees/abc")).toBe("ideabox");
  });
  it("事件 → 狀態", () => {
    expect(statusFor({ hook_event_name: "SessionStart" })).toBe("idle");
    expect(statusFor({ hook_event_name: "UserPromptSubmit" })).toBe("working");
    expect(statusFor({ hook_event_name: "Stop" })).toBe("waiting");
    expect(statusFor({ hook_event_name: "Notification", message: "Claude needs your permission to use Bash" })).toBe("permission");
    expect(statusFor({ hook_event_name: "Notification", notification_type: "idle_prompt" })).toBe("waiting");
    expect(statusFor({ hook_event_name: "SessionEnd" })).toBe("ended");
    expect(statusFor({ hook_event_name: "PostToolUse" })).toBe("working");
    expect(statusFor({ hook_event_name: "PreToolUse" })).toBeNull();
  });
  it("遮掉金鑰、權杖、密碼", () => {
    const t = maskSecrets("用 sk-ant-abcdefghijklmnop 跟 xoxb-123456789-abcdef 還有 password: hunter2 和 ghp_abcdefghijklmnopqrstu");
    expect(t).not.toMatch(/sk-ant|xoxb-1|hunter2|ghp_/);
    expect(maskSecrets("修好地圖火焰動畫")).toBe("修好地圖火焰動畫");
  });
  it("7 天內上過班的都留著；關掉或 30 分鐘沒動靜 = 下班；工作中超過 10 分鐘沒心跳 = 休息中", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const s = (over: Partial<AgentSession>): AgentSession => ({ session_id: "a", project_id: null, folder: null, role: null, task: null, status: "working", started_at: "2026-11-02T09:00:00Z", updated_at: "2026-11-02T09:59:00Z", ended_at: null, ...over });
    expect(visibleSessions([s({}), s({ session_id: "b", status: "ended" }), s({ session_id: "c", updated_at: "2026-10-20T01:00:00Z" })], now).map((x) => x.session_id)).toEqual(["a", "b"]);
    expect(displayStatus(s({ status: "ended" }), now)).toBe("ended");
    expect(displayStatus(s({ status: "waiting", updated_at: "2026-11-02T09:20:00Z" }), now)).toBe("ended");
    expect(displayStatus(s({ status: "waiting", updated_at: "2026-11-02T09:40:00Z" }), now)).toBe("waiting");
    expect(displayStatus(s({ updated_at: "2026-11-02T09:45:00Z" }), now)).toBe("idle");
    expect(displayStatus(s({}), now)).toBe("working");
    expect(onDuty(s({}), now)).toBe(true);
    expect(onDuty(s({ status: "ended" }), now)).toBe(false);
  });
  it("同專案同職位是同一個人：誰在工作就是他在工作；都沒在做就是待機", () => {
    const now = Date.parse("2026-11-02T10:00:00Z");
    const s = (over: Partial<AgentSession>): AgentSession => ({ session_id: "a", project_id: "p", folder: null, role: "法律顧問", task: "舊合約", status: "ended", started_at: "2026-11-01T09:00:00Z", updated_at: "2026-11-01T10:00:00Z", ended_at: null, ...over });
    const staff = staffOf([s({}), s({ session_id: "b", task: "擬設計合約", status: "working", started_at: "2026-11-02T09:00:00Z", updated_at: "2026-11-02T09:59:00Z" }), s({ session_id: "c", role: "設計師" })], now);
    expect(staff).toHaveLength(2);
    expect(staff[0]).toMatchObject({ session_id: "p:法律顧問", task: "擬設計合約", status: "working", started_at: "2026-11-01T09:00:00Z", sessions: 1 });
    expect(displayStatus(staff[1], now)).toBe("ended");
  });
  it("階段歷程：從日誌還原每段待了幾天", () => {
    const p = { stages: ["開發", "封測", "上架審核"], stage: 2, created_at: "2026-10-01T00:00:00Z", last_activity_at: "2026-11-01T00:00:00Z" };
    const segs = stageSegments(
      p,
      [
        { at: "2026-10-21T00:00:00Z", text: "階段：封測 → 上架審核" },
        { at: "2026-10-11T00:00:00Z", text: "階段：開發 → 封測" },
        { at: "2026-10-12T00:00:00Z", text: "下一步：送審" },
      ],
      Date.parse("2026-11-02T00:00:00Z"),
    );
    expect(segs.map((s) => [s.name, s.days, s.current])).toEqual([["開發", 10, false], ["封測", 10, false], ["上架審核", 12, true]]);
    expect(stageSegments(p, [], Date.parse("2026-10-03T00:00:00Z")).map((s) => [s.name, s.days])).toEqual([["上架審核", 2]]);
  });
});

// ---------- hook 端點 ----------

let aiBodies: any[] = [];
beforeEach(() => {
  reset();
  aiBodies = [];
  pending.length = 0;
  tables.projects.push({ id: FIT_ID, slug: "fit", name: "Fit", folder: "Fit", stages: ["開發"], stage: 0, status: "active", sort: 10 });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(String(init?.body));
      aiBodies.push(body);
      return Response.json({ content: [{ type: "tool_use", id: "t", name: body.tools[0].name, input: { role: "前端工程師", task: "修地圖火焰動畫" } }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } });
    }
    throw new Error("unexpected fetch " + url);
  });
});

async function hook(body: Record<string, unknown>, secret = "hook-secret", host?: string) {
  const { POST } = await import("@/app/api/claude/hook/route");
  const headers: Record<string, string> = { "x-ideabox-hook": secret, "content-type": "application/json" };
  if (host) headers["x-ideabox-host"] = host;
  const res = await POST(new Request("https://x/api/claude/hook", { method: "POST", headers, body: JSON.stringify(body) }) as any);
  await Promise.all(pending);
  pending.length = 0;
  return res.status;
}

describe("Claude Code 回報", () => {
  it("密鑰不對就拒絕", async () => {
    expect(await hook({ hook_event_name: "SessionStart", session_id: "s1" }, "wrong")).toBe(401);
    expect(tables.agent_sessions).toHaveLength(0);
  });
  it("開工 → 交代事情（AI 判斷職位、只存摘要不存原文）→ 等你同意 → 等回覆 → 結束", async () => {
    expect(await hook({ hook_event_name: "SessionStart", session_id: "s1", cwd: "/Users/me/ai/Fit" })).toBe(200);
    expect(tables.agent_sessions[0]).toMatchObject({ project_id: FIT_ID, folder: "Fit", status: "idle" });

    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: "/Users/me/ai/Fit", prompt: "幫我修地圖的火焰動畫，api key 是 sk-ant-abcdefghijklmnopqrstuv" });
    expect(tables.agent_sessions[0]).toMatchObject({ status: "working", role: "前端工程師", task: "修地圖火焰動畫" });
    expect(JSON.stringify(aiBodies[0])).not.toContain("sk-ant-abcdefghijklmnopqrstuv");
    expect(aiBodies[0].system).toContain("專案：Fit");
    expect(JSON.stringify(tables.agent_sessions[0])).not.toContain("火焰動畫，api");

    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "好" });
    expect(aiBodies).toHaveLength(1); // 短回覆不重新判斷

    await hook({ hook_event_name: "Notification", session_id: "s1", message: "Claude needs your permission to use Bash" });
    expect(tables.agent_sessions[0].status).toBe("permission");
    await hook({ hook_event_name: "Stop", session_id: "s1" });
    expect(tables.agent_sessions[0].status).toBe("waiting");
    await hook({ hook_event_name: "SessionEnd", session_id: "s1" });
    expect(tables.agent_sessions[0]).toMatchObject({ status: "ended" });
    expect(tables.agent_sessions[0].ended_at).toBeTruthy();
  });
  it("心跳讓「等你同意」回到工作中；下班後心跳不會把人叫回來，重新交代事情才會；可以手動請他下班", async () => {
    await hook({ hook_event_name: "Notification", session_id: "s3", cwd: "/Users/me/ai/Fit", message: "Claude needs your permission" });
    expect(tables.agent_sessions[0].status).toBe("permission");
    await hook({ hook_event_name: "PostToolUse", session_id: "s3" });
    expect(tables.agent_sessions[0].status).toBe("working");
    await hook({ hook_event_name: "SessionEnd", session_id: "s3" });
    await hook({ hook_event_name: "PostToolUse", session_id: "s3" });
    expect(tables.agent_sessions[0].status).toBe("ended");
    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s3", prompt: "再幫我看一下" });
    expect(tables.agent_sessions[0].status).toBe("working");
    const { endSession } = await import("@/lib/office");
    await endSession("s3");
    expect(tables.agent_sessions[0].status).toBe("ended");
  });

  it("手動指定職位後，AI 只更新任務、不再改職位；不在清單上的職位不收", async () => {
    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s4", cwd: "/Users/me/ai/Fit", prompt: "幫我擬 Icon 設計的合約" });
    expect(tables.agent_sessions[0].role).toBe("前端工程師");
    expect(aiBodies[0].system).toContain("法律顧問（就算合約是關於設計）");
    const { setSessionRole } = await import("@/lib/office");
    expect(await setSessionRole("s4", "老闆")).toMatchObject({ ok: false });
    expect(await setSessionRole("s4", "法律顧問")).toEqual({ ok: true, locked: true });
    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s4", prompt: "再加一條智慧財產權歸屬的條款" });
    expect(aiBodies).toHaveLength(2);
    expect(aiBodies[1].system).toContain("創業家指定的「法律顧問」");
    expect(tables.agent_sessions[0]).toMatchObject({ role: "法律顧問", role_locked: true, task: "修地圖火焰動畫" });
  });

  it("對不到專案的資料夾放大廳；沒有 session_id 的忽略", async () => {
    await hook({ hook_event_name: "UserPromptSubmit", session_id: "s2", cwd: "/Users/me/ideabox", prompt: "幫我整理專案頁的版面" });
    expect(tables.agent_sessions[0]).toMatchObject({ project_id: null, folder: "ideabox", status: "working" });
    await hook({ hook_event_name: "Stop" });
    expect(tables.agent_sessions).toHaveLength(1);
    // 在專案設定加上這個資料夾後，下一次回報就搬進專案房間
    tables.projects[0].folder = "ideabox";
    await hook({ hook_event_name: "Stop", session_id: "s2", cwd: "/Users/me/ideabox" });
    expect(tables.agent_sessions[0].project_id).toBe(FIT_ID);
  });
});

describe("交接（一個 Claude 開新工作階段交給另一個）", () => {
  it("規則：只認桌面 App 的工具名稱與 local_ 編號，扣掉自己", async () => {
    const { cleanHostId, handoffTargets, isHandoffTool, handoffLive } = await import("@/lib/officeLogic");
    expect(isHandoffTool("mcp__ccd_session__start_session")).toBe(true);
    expect(isHandoffTool("mcp__ccd_session__hand_off_to_session")).toBe(true);
    expect(isHandoffTool("mcp__ccd_session__dismiss_task")).toBe(false);
    expect(isHandoffTool("Bash")).toBe(false);
    expect(cleanHostId("local_abc123")).toBe("local_abc123");
    expect(cleanHostId("local_; rm -rf /")).toBeNull();
    expect(cleanHostId(undefined)).toBeNull();
    expect(handoffTargets([{ type: "text", text: "Started session local_child1 (name: fix-map)" }], "local_me")).toEqual(["local_child1"]);
    expect(handoffTargets({ text: "local_me local_me" }, "local_me")).toEqual([]);
    expect(handoffTargets("Proposed task task_ab12cd34", null)).toEqual([]);
    const now = Date.now();
    expect(handoffLive({ status: "working", updated_at: new Date(now).toISOString() }, now)).toBe(true);
    expect(handoffLive({ status: "ended", updated_at: new Date(now).toISOString() }, now)).toBe(false);
    expect(handoffLive(undefined, now)).toBe(false);
  });
  it("交出去的 Claude 開了新工作階段 → 記一筆；接手的開工後對得上；只是提議（沒有編號）不記", async () => {
    await hook({ hook_event_name: "UserPromptSubmit", session_id: "parent", cwd: "/Users/me/ai/Fit", prompt: "幫我把地圖動畫交給另一個人做" }, "hook-secret", "local_parent");
    expect(tables.agent_sessions[0].host_id).toBe("local_parent");
    // 提議卡片：回傳只有 task_ 編號
    await hook({ hook_event_name: "PostToolUse", session_id: "parent", tool_name: "mcp__ccd_session__start_session", tool_input: { title: "修地圖動畫", initiation: "own_initiative" }, tool_response: [{ type: "text", text: "Proposed task_ab12cd34" }] }, "hook-secret", "local_parent");
    expect(tables.agent_handoffs).toHaveLength(0);
    // 真的開了
    const started = { hook_event_name: "PostToolUse", session_id: "parent", tool_name: "mcp__ccd_session__start_session", tool_input: { title: "修地圖動畫 token=abcdef123456" }, tool_response: [{ type: "text", text: "Started local_child1" }] };
    await hook(started, "hook-secret", "local_parent");
    await hook(started, "hook-secret", "local_parent"); // 重送不重複
    expect(tables.agent_handoffs).toHaveLength(1);
    expect(tables.agent_handoffs[0]).toMatchObject({ from_session: "parent", to_host: "local_child1" });
    expect(tables.agent_handoffs[0].title).not.toContain("abcdef123456");

    const { listOffice } = await import("@/lib/office");
    expect((await listOffice()).handoffs[0]).toMatchObject({ from: "parent", to: null }); // 接手的還沒回報
    await hook({ hook_event_name: "SessionStart", session_id: "child", cwd: "/Users/me/ai/Fit" }, "hook-secret", "local_child1");
    expect((await listOffice()).handoffs[0]).toMatchObject({ from: "parent", to: "child" });
  });
  it("沒帶編號（舊版腳本、終端機）照常運作", async () => {
    expect(await hook({ hook_event_name: "SessionStart", session_id: "plain", cwd: "/Users/me/ai/Fit" })).toBe(200);
    expect(tables.agent_sessions[0].host_id).toBeUndefined();
    expect((await listOffice2()).handoffs).toEqual([]);
  });
});
const listOffice2 = async () => (await import("@/lib/office")).listOffice();

describe("辦公室的重點數字", () => {
  it("工作中、等你、休息中、下班；交接只算台北時間的今天", async () => {
    const { officeCounts } = await import("@/lib/officeLogic");
    const now = Date.parse("2026-11-18T01:00:00Z"); // 台北 11/18 09:00
    const s = (status: AgentSession["status"], minAgo: number) => ({ status, updated_at: new Date(now - minAgo * 60_000).toISOString() });
    const c = officeCounts(
      [s("working", 1), s("working", 15), s("waiting", 2), s("permission", 3), s("idle", 5), s("ended", 1), s("working", 45)],
      [{ created_at: "2026-11-17T16:30:00Z" }, { created_at: "2026-11-17T15:30:00Z" }, { created_at: "2026-11-18T00:10:00Z" }], // 台北 11/18 00:30、11/17 23:30、11/18 08:10
      now,
    );
    expect(c).toEqual({ working: 1, needYou: 2, idle: 2, off: 2, handoffsToday: 2 });
  });
});
