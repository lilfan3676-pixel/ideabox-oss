// 合夥人帳號：權限邏輯、邀請連結設密碼、專案編輯權限、手機 App 資料過濾、推送對象
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, reset, tables } from "./support/fakeDb";
import {
  accessOf,
  appTabs,
  can,
  cleanMember,
  editsProject,
  homeHref,
  memberGetsPush,
  navHrefs,
  OWNER_ACCESS,
  productsFor,
  seesProject,
  type Access,
} from "@/lib/accessLogic";
import { sha256 } from "@/lib/appLogic";

// 假的 Supabase 登入帳號管理（建立帳號、改密碼）
const users: { id: string; email: string; password: string }[] = [];
const admin = {
  createUser: async ({ email, password }: { email: string; password: string }) => {
    if (users.some((u) => u.email === email)) return { data: { user: null }, error: { message: "already registered" } };
    const user = { id: `u-${users.length + 1}`, email, password };
    users.push(user);
    return { data: { user }, error: null };
  },
  updateUserById: async (id: string, { password }: { password: string }) => {
    const u = users.find((x) => x.id === id);
    if (!u) return { data: null, error: { message: "not found" } };
    u.password = password;
    return { data: { user: u }, error: null };
  },
  listUsers: async () => ({ data: { users }, error: null }),
  deleteUser: async (id: string) => {
    users.splice(users.findIndex((u) => u.id === id), 1);
    return { error: null };
  },
};

vi.mock("@/lib/db", async (orig) => {
  const actual = await orig<typeof import("@/lib/db")>();
  return { ...actual, db: () => ({ ...fakeDb, auth: { admin } }) };
});

// 目前登入的是誰（專案動作測試用）
let viewer: Access = OWNER_ACCESS;
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => {
    if (!viewer.owner) throw new Error("redirect");
    return { email: "me" };
  },
  requireProjectEdit: async (id: string) => {
    const { editsProject } = await import("@/lib/accessLogic");
    if (!editsProject(viewer, id)) throw new Error("沒有權限");
    return viewer;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

process.env.TELEGRAM_BOT_TOKEN = "TOKEN";
process.env.TELEGRAM_OWNER_ID = "111";

const A = "11111111-1111-1111-1111-111111111111"; // 合夥人的專案
const B = "22222222-2222-2222-2222-222222222222"; // 別的專案
const M = "33333333-3333-3333-3333-333333333333";
const member = (over: Record<string, unknown> = {}) => ({
  id: M,
  email: "pat@example.com",
  name: "小林",
  project_ids: [A],
  pages: ["projects", "calendar", "monitor"],
  can_edit: true,
  push: true,
  active: true,
  user_id: null,
  invite_hash: null,
  invite_exp: null,
  last_login_at: null,
  created_at: "2026-11-16T00:00:00Z",
  ...over,
});

type PushCall = { to: string; title: string };
let pushes: PushCall[] = [];

beforeEach(() => {
  reset();
  users.length = 0;
  viewer = OWNER_ACCESS;
  pushes = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("exp.host")) {
      const msgs = JSON.parse(String(init?.body)) as PushCall[];
      pushes.push(...msgs);
      return Response.json({ data: msgs.map(() => ({ status: "ok" })) });
    }
    if (String(url).includes("api.telegram.org")) return Response.json({ ok: true, result: { message_id: 1 } });
    throw new Error(`沒預期的請求 ${url}`);
  });
  tables.projects.push(
    { id: A, slug: "cafe", name: "Cafe", stages: ["構想", "開發"], stage: 1, next_step: null, status: "active", sort: 10, last_activity_at: "2026-11-16T00:00:00Z" },
    { id: B, slug: "fit", name: "Fit", stages: ["構想", "開發"], stage: 0, next_step: null, status: "active", sort: 20, last_activity_at: "2026-11-16T00:00:00Z" },
  );
});

describe("權限邏輯", () => {
  const a = accessOf(member());
  it("主人看得到全部；合夥人只看勾選的畫面與專案", () => {
    expect(can(OWNER_ACCESS, "grants")).toBe(true);
    expect(can(a, "projects")).toBe(true);
    expect(can(a, "ideas")).toBe(false);
    expect(seesProject(a, A)).toBe(true);
    expect(seesProject(a, B)).toBe(false);
    expect(seesProject(a, null)).toBe(false);
  });

  it("可編輯只限他的專案；只看的人不能改", () => {
    expect(editsProject(a, A)).toBe(true);
    expect(editsProject(a, B)).toBe(false);
    expect(editsProject(accessOf(member({ can_edit: false })), A)).toBe(false);
    // 沒開專案也沒開月曆的人，就算勾了可編輯也不能改
    expect(editsProject(accessOf(member({ pages: ["monitor"] })), A)).toBe(false);
  });

  it("選單、首頁、App 分頁照權限", () => {
    expect(navHrefs(OWNER_ACCESS)).toBeNull();
    expect(navHrefs(a)).toEqual(["/projects", "/social", "/monitor"]); // 看得到專案的人也看得到社群助手
    expect(homeHref(a)).toBe("/projects");
    expect(homeHref(accessOf(member({ pages: ["calendar"] })))).toBe("/projects?view=calendar");
    expect(homeHref(accessOf(member({ pages: [] })))).toBe("/no-access");
    expect(appTabs(a)).toEqual(["today", "calendar", "projects", "monitor"]);
    expect(appTabs(OWNER_ACCESS)).toContain("office");
  });

  it("不認得的畫面名稱會被丟掉", () => {
    expect(accessOf(member({ pages: ["projects", "costs", "settings"] })).owner === false && accessOf(member({ pages: ["projects", "costs"] }))).toMatchObject({ pages: ["projects"] });
  });

  it("監控產品：只給對得到他專案短名的", () => {
    const products = [{ key: "cafe" }, { key: "x", slugs: ["fit"] }, { key: "site:1", slugs: [] }];
    expect(productsFor(a, ["cafe"], products).map((p) => p.key)).toEqual(["cafe"]);
    expect(productsFor(OWNER_ACCESS, [], products)).toHaveLength(3);
  });

  it("表單檢查：Email、不能是自己、至少一個專案和畫面、只收認得的專案", () => {
    const ok = cleanMember({ name: " 小林 ", email: "Pat@Example.com", projects: [A, "nope"], pages: ["projects", "costs"], canEdit: true, push: false }, "me@example.com", [A, B]);
    expect(ok).toEqual({ name: "小林", email: "pat@example.com", project_ids: [A], pages: ["projects"], can_edit: true, push: false });
    expect(cleanMember({ name: "a", email: "me@example.com", projects: [A], pages: ["projects"], canEdit: false, push: true }, "ME@example.com", [A])).toHaveProperty("error");
    expect(cleanMember({ name: "a", email: "bad", projects: [A], pages: ["projects"], canEdit: false, push: true }, "me@x.com", [A])).toHaveProperty("error");
    expect(cleanMember({ name: "a", email: "a@b.co", projects: [], pages: ["projects"], canEdit: false, push: true }, "me@x.com", [A])).toHaveProperty("error");
    expect(cleanMember({ name: "a", email: "a@b.co", projects: [A], pages: [], canEdit: false, push: true }, "me@x.com", [A])).toHaveProperty("error");
    // 話題雷達要和專案一起開
    expect(cleanMember({ name: "a", email: "a@b.co", projects: [A], pages: ["radar"], canEdit: false, push: true }, "me@x.com", [A])).toHaveProperty("error");
    // 改權限時不用 Email
    expect(cleanMember({ name: "a", projects: [A], pages: ["monitor"], canEdit: false, push: true }, "me@x.com", [A], false)).not.toHaveProperty("error");
  });

  it("推送對象：有開推送、有畫面權限、看得到專案才收；停用的不收", () => {
    const m = member();
    expect(memberGetsPush(m, { projectIds: [A], pages: ["projects", "calendar"] })).toBe(true);
    expect(memberGetsPush(m, { projectIds: [B], pages: ["projects"] })).toBe(false);
    expect(memberGetsPush(m, undefined)).toBe(false);
    expect(memberGetsPush(member({ push: false }), { projectIds: [A], pages: ["projects"] })).toBe(false);
    expect(memberGetsPush(member({ active: false }), { projectIds: [A], pages: ["projects"] })).toBe(false);
    expect(memberGetsPush(member({ pages: ["projects"] }), { projectIds: [A], pages: ["monitor"] })).toBe(false);
  });
});

describe("邀請連結", () => {
  it("建立合夥人 → 連結設密碼 → 連結作廢；Email 不能重複", async () => {
    const { createMember, memberByInvite, acceptInvite } = await import("@/lib/members");
    const r = await createMember({ name: "小林", email: "pat@example.com", project_ids: [A], pages: ["projects"], can_edit: false, push: true });
    if ("error" in r) throw new Error("建立失敗");
    expect(tables.members[0].invite_hash).toBe(sha256(r.token)); // 只存雜湊
    expect(await createMember({ name: "x", email: "pat@example.com", project_ids: [A], pages: ["projects"], can_edit: false, push: true })).toEqual({ error: "exists" });

    expect((await memberByInvite(r.token))?.name).toBe("小林");
    expect(await acceptInvite(r.token, "short")).toEqual({ ok: false, error: "weak" });
    expect(await acceptInvite("x".repeat(30), "longenough1")).toEqual({ ok: false, error: "invalid" });
    expect(await acceptInvite(r.token, "longenough1")).toEqual({ ok: true, email: "pat@example.com" });
    expect(users).toEqual([{ id: "u-1", email: "pat@example.com", password: "longenough1" }]);
    expect(tables.members[0]).toMatchObject({ user_id: "u-1", invite_hash: null });
    // 用過就失效
    expect(await memberByInvite(r.token)).toBeNull();
  });

  it("過期的連結不能用；重設密碼連結會改原本帳號的密碼", async () => {
    const { createMember, acceptInvite, resetInvite, memberByInvite } = await import("@/lib/members");
    const now = Date.parse("2026-11-16T00:00:00Z");
    const r = await createMember({ name: "小林", email: "pat@example.com", project_ids: [A], pages: ["projects"], can_edit: false, push: true }, now);
    if ("error" in r) throw new Error("建立失敗");
    expect(await memberByInvite(r.token, now + 8 * 86_400_000)).toBeNull();
    await acceptInvite(r.token, "firstpass1", now);
    const t2 = await resetInvite(tables.members[0].id, now);
    expect(await acceptInvite(t2, "secondpass2", now)).toMatchObject({ ok: true });
    expect(users).toHaveLength(1);
    expect(users[0].password).toBe("secondpass2");
  });

  it("停用：手機一起解除、連結失效；刪除：登入帳號也刪掉", async () => {
    const { setMemberActive, deleteMember, memberByInvite } = await import("@/lib/members");
    tables.members.push(member({ user_id: "u-9", invite_hash: sha256("t".repeat(40)), invite_exp: "2099-01-01T00:00:00Z" }));
    users.push({ id: "u-9", email: "pat@example.com", password: "x" });
    tables.app_devices.push({ id: "d1", name: "林的 iPhone", token_hash: "h", push_token: null, member_id: M, last_seen_at: "2026-11-16T00:00:00Z" });
    await setMemberActive(M, false);
    expect(tables.app_devices).toHaveLength(0);
    expect(await memberByInvite("t".repeat(40))).toBeNull();
    await deleteMember(M);
    expect(tables.members).toHaveLength(0);
    expect(users).toHaveLength(0);
  });
});

describe("專案編輯權限（伺服器端）", () => {
  beforeEach(() => {
    tables.project_milestones.push(
      { id: "aaaaaaaa-0000-0000-0000-000000000001", project_id: A, title: "送件", due: "2026-12-11", done: false },
      { id: "aaaaaaaa-0000-0000-0000-000000000002", project_id: B, title: "上架", due: "2026-12-20", done: false },
    );
  });

  it("可編輯的合夥人：能勾他專案的里程碑、寫日誌（記上名字），碰不到別的專案", async () => {
    viewer = accessOf(member());
    const act = await import("@/app/(dash)/projects/actions");
    expect(await act.toggleMilestone("aaaaaaaa-0000-0000-0000-000000000001")).toEqual({ ok: true });
    expect(tables.project_logs.at(-1)).toMatchObject({ project_id: A, text: "小林：完成里程碑：送件" });
    expect(await act.toggleMilestone("aaaaaaaa-0000-0000-0000-000000000002")).toEqual({ ok: false });
    expect(tables.project_milestones[1].done).toBe(false);
    expect(await act.addLog(B, "偷改")).toEqual({ ok: false });
    expect(await act.addLog(A, "寄信給產學處")).toEqual({ ok: true });
    expect(tables.project_logs.at(-1)).toMatchObject({ text: "小林：寄信給產學處" });
    expect(await act.deleteMilestone("aaaaaaaa-0000-0000-0000-000000000002")).toEqual({ ok: false });
    expect(tables.project_milestones).toHaveLength(2);
  });

  it("只看的合夥人什麼都改不了；階段、下一步只有主人能改", async () => {
    viewer = accessOf(member({ can_edit: false }));
    const act = await import("@/app/(dash)/projects/actions");
    expect(await act.toggleMilestone("aaaaaaaa-0000-0000-0000-000000000001")).toEqual({ ok: false });
    expect((await act.addEventAction(A, "開會", "2026-11-20", "2026-11-20")).ok).toBe(false);
    viewer = accessOf(member());
    await expect(act.setStage(A, 0)).rejects.toThrow();
    await expect(act.setNextStep(A, "x")).rejects.toThrow();
  });

  it("排程：不能把別的專案的排程搬進來或刪掉", async () => {
    tables.project_events.push({ id: "bbbbbbbb-0000-0000-0000-000000000001", project_id: B, title: "別人的", start_date: "2026-11-20", end_date: "2026-11-20" });
    viewer = accessOf(member());
    const act = await import("@/app/(dash)/projects/actions");
    expect((await act.updateEventAction("bbbbbbbb-0000-0000-0000-000000000001", { title: "我的了", start: "2026-11-20", end: "2026-11-20", projectId: A })).ok).toBe(false);
    expect(await act.deleteEventAction("bbbbbbbb-0000-0000-0000-000000000001")).toEqual({ ok: false });
    expect(tables.project_events).toHaveLength(1);
    expect((await act.addEventAction(A, "跟產學處開會", "2026-11-20", "2026-11-20")).ok).toBe(true);
    expect(tables.project_logs.at(-1)!.text).toContain("小林：新增排程：跟產學處開會");
  });
});

describe("手機 App（合夥人的手機）", () => {
  const TOKEN = "member-device-token-0123456789";
  const auth = { authorization: `Bearer ${TOKEN}` };
  beforeEach(() => {
    tables.members.push(member());
    tables.app_devices.push(
      { id: "dm", name: "林的 iPhone", token_hash: sha256(TOKEN), push_token: "ExponentPushToken[m]", member_id: M, last_seen_at: new Date().toISOString() },
      { id: "do", name: "我的 iPhone", token_hash: "owner-hash", push_token: "ExponentPushToken[o]", last_seen_at: new Date().toISOString() },
    );
    tables.project_events.push( // 結束日放很遠：首頁看的是「今天」的排程，寫死單一天的話隔天測試就會壞
      { id: "e1", project_id: A, title: "送件準備", start_date: "2026-11-20", end_date: "2099-12-31", start_time: null },
      { id: "e2", project_id: B, title: "別人的會", start_date: "2026-11-20", end_date: "2099-12-31", start_time: null },
    );
  });

  it("首頁只有他的專案和排程，並帶回能看的分頁；辦公室、點子擋掉", async () => {
    const home = await import("@/app/api/app/home/route");
    const res = await home.GET(new Request("https://x/api/app/home", { headers: auth }));
    const body = await res.json();
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([A]);
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["e1"]);
    expect(body.access).toMatchObject({ owner: false, name: "小林", tabs: ["today", "calendar", "projects", "monitor"] });
    const office = await import("@/app/api/app/office/route");
    expect((await office.GET(new Request("https://x/api/app/office", { headers: auth }))).status).toBe(403);
    const ideas = await import("@/app/api/app/ideas/route");
    expect((await ideas.GET(new Request("https://x/api/app/ideas", { headers: auth }))).status).toBe(403);
    const proj = await import("@/app/api/app/projects/[slug]/route");
    expect((await proj.GET(new Request("https://x/api/app/projects/fit", { headers: auth }), { params: Promise.resolve({ slug: "fit" }) })).status).toBe(404);
    expect((await proj.GET(new Request("https://x/api/app/projects/cafe", { headers: auth }), { params: Promise.resolve({ slug: "cafe" }) })).status).toBe(200);
  });

  it("合夥人被停用：手機馬上被登出（401）", async () => {
    tables.members[0].active = false;
    const home = await import("@/app/api/app/home/route");
    expect((await home.GET(new Request("https://x/api/app/home", { headers: auth }))).status).toBe(401);
  });

  it("推送：別的專案的事只推給你；他專案的事你們都收到", async () => {
    const { sendPush } = await import("@/lib/app");
    await sendPush({ title: "B 的事", body: "" }, { projectIds: [B], pages: ["projects"] });
    expect(pushes.map((p) => p.to)).toEqual(["ExponentPushToken[o]"]);
    pushes = [];
    await sendPush({ title: "A 的事", body: "" }, { projectIds: [A], pages: ["projects"] });
    expect(pushes.map((p) => p.to).sort()).toEqual(["ExponentPushToken[m]", "ExponentPushToken[o]"]);
    pushes = [];
    await sendPush({ title: "沒有範圍", body: "" });
    expect(pushes.map((p) => p.to)).toEqual(["ExponentPushToken[o]"]);
  });

  it("早上的今日排程：你收全部，他只收他專案的", async () => {
    const { pushTodayEvents } = await import("@/lib/app");
    await pushTodayEvents(Date.parse("2026-11-20T00:00:00Z"));
    const mine = pushes.find((p) => p.to === "ExponentPushToken[m]")!;
    const owner = pushes.find((p) => p.to === "ExponentPushToken[o]")!;
    expect(pushes).toHaveLength(2);
    expect(JSON.stringify(mine)).toContain("送件準備");
    expect(JSON.stringify(mine)).not.toContain("別人的會");
    expect(JSON.stringify(owner)).toContain("別人的會");
  });

  it("你的配對碼和合夥人的配對碼互不影響", async () => {
    const { createPairCode, redeemPairCode } = await import("@/lib/app");
    const mine = await createPairCode(Date.now());
    const his = await createPairCode(Date.now(), M);
    expect((await redeemPairCode(mine.code, "我的新手機"))?.memberId).toBeNull();
    expect((await redeemPairCode(his.code, "他的新手機"))?.memberId).toBe(M);
    // 用過就失效
    expect(await redeemPairCode(his.code, "再一次")).toBeNull();
  });

  it("替合夥人產生的配對碼：配好的手機是他的，回傳他的分頁", async () => {
    const { createPairCode } = await import("@/lib/app");
    const { code } = await createPairCode(Date.now(), M);
    const pair = await import("@/app/api/app/pair/route");
    const res = await pair.POST(new Request("https://x/api/app/pair", { method: "POST", body: JSON.stringify({ code, name: "新手機" }) }));
    const body = await res.json();
    expect(body.tabs).toEqual(["today", "calendar", "projects", "monitor"]);
    expect(tables.app_devices.find((d) => d.name === "新手機")!.member_id).toBe(M);
  });
});

describe("我的帳號（合夥人自己改）", () => {
  const verifyWith = (pw: string, uid: string) => async (_email: string, p: string) => (p === pw ? uid : null);

  it("改密碼：目前密碼要對、新密碼要夠長且不一樣、只改自己的登入帳號", async () => {
    const { changeMemberPassword } = await import("@/lib/members");
    users.push({ id: "u-1", email: "pat@example.com", password: "oldpass11" }, { id: "u-2", email: "other@example.com", password: "keep" });
    const m = { email: "pat@example.com", user_id: "u-1" };
    expect(await changeMemberPassword(m, "oldpass11", "short", verifyWith("oldpass11", "u-1"))).toEqual({ ok: false, error: "weak" });
    expect(await changeMemberPassword(m, "oldpass11", "oldpass11", verifyWith("oldpass11", "u-1"))).toEqual({ ok: false, error: "same" });
    expect(await changeMemberPassword(m, "wrongpass", "newpass22", verifyWith("oldpass11", "u-1"))).toEqual({ ok: false, error: "wrong" });
    // 密碼對到的是別的帳號也不行
    expect(await changeMemberPassword(m, "oldpass11", "newpass22", verifyWith("oldpass11", "u-2"))).toEqual({ ok: false, error: "wrong" });
    expect(await changeMemberPassword({ ...m, user_id: null }, "oldpass11", "newpass22", verifyWith("oldpass11", "u-1"))).toEqual({ ok: false, error: "failed" });
    expect(await changeMemberPassword(m, "oldpass11", "newpass22", verifyWith("oldpass11", "u-1"))).toEqual({ ok: true });
    expect(users.find((u) => u.id === "u-1")!.password).toBe("newpass22");
    expect(users.find((u) => u.id === "u-2")!.password).toBe("keep");
  });

  it("推送開關、解除手機：只動得到自己的", async () => {
    const { setMemberPush, removeMemberDevice } = await import("@/lib/members");
    const OTHER = "44444444-4444-4444-4444-444444444444";
    tables.members.push(member(), member({ id: OTHER, email: "x@example.com" }));
    tables.app_devices.push(
      { id: "d1", name: "我的", token_hash: "h1", push_token: null, member_id: M, last_seen_at: "2026-11-16T00:00:00Z" },
      { id: "d2", name: "別人的", token_hash: "h2", push_token: null, member_id: OTHER, last_seen_at: "2026-11-16T00:00:00Z" },
      { id: "d3", name: "主人的", token_hash: "h3", push_token: null, member_id: null, last_seen_at: "2026-11-16T00:00:00Z" },
    );
    await setMemberPush(M, false);
    expect(tables.members.map((x) => x.push)).toEqual([false, true]);
    await removeMemberDevice(M, "d2");
    await removeMemberDevice(M, "d3");
    expect(tables.app_devices).toHaveLength(3);
    await removeMemberDevice(M, "d1");
    expect(tables.app_devices.map((d) => d.id)).toEqual(["d2", "d3"]);
  });
});
