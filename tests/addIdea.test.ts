import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ email: "me" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const base = { id: "1", summary: "好點子", content: null, url: null, status: "analyzed", category: "arx_feature", folder_id: "f1" };
vi.mock("@/lib/ideas", () => ({
  ingestLink: async (u: string) =>
    u.includes("github")
      ? { idea: { ...base, id: "2", category: "github", summary: "元件庫" }, duplicate: false }
      : u.includes("bad")
        ? null
        : { idea: { ...base, status: "needs_input", category: null, summary: null, url: u }, duplicate: true },
  ingestText: async () => base,
  reanalyze: async () => base,
}));

describe("網頁新增點子的回饋", () => {
  it("回傳每則存到哪裡、分類、是否重複與失敗數", async () => {
    const { addIdea } = await import("@/app/(dash)/actions");
    const f = new FormData();
    f.set("input", "https://github.com/a/b https://www.threads.com/@x/post/Y https://bad.example");
    const r = (await addIdea(null, f))!;
    expect(r.failed).toBe(1);
    expect(r.items).toEqual([
      { id: "2", folderId: "f1", category: "github", summary: "元件庫", status: "analyzed", duplicate: false },
      expect.objectContaining({ category: null, status: "needs_input", duplicate: true }),
    ]);
  });
  it("純文字存進點子庫；空白回錯誤訊息", async () => {
    const { addIdea } = await import("@/app/(dash)/actions");
    const f = new FormData();
    f.set("input", "做一個好友挑戰");
    expect((await addIdea(null, f))!.items[0]).toMatchObject({ folderId: "f1", summary: "好點子" });
    const empty = new FormData();
    expect((await addIdea(null, empty))!.error).toBeTruthy();
  });
});
