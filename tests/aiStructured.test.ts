import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({ from: () => ({ insert: async () => ({}) }) }) }));
process.env.ANTHROPIC_API_KEY = "k";

const { callStructured, canForceTool } = await import("@/lib/ai");

type Body = { tool_choice: { type: string }; thinking?: { type: string }; system: string };
function stub(responses: unknown[][]) {
  const bodies: Body[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    const content = responses[bodies.length - 1] ?? [];
    return new Response(JSON.stringify({ content, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }));
  return bodies;
}
const opts = (model: string) => ({ model, system: "整理", content: "資料", toolName: "report", toolDescription: "d", schema: { type: "object" } });
const tool = [{ type: "tool_use", id: "t", name: "report", input: { ok: 1 } }];

afterEach(() => vi.unstubAllGlobals());

describe("callStructured：不能強制工具的模型", () => {
  it("哪些模型不能強制", () => {
    expect(canForceTool("claude-sonnet-5-5")).toBe(false);
    expect(canForceTool("claude-opus-5-5")).toBe(false);
    expect(canForceTool("claude-haiku-5-5")).toBe(true);
  });

  it("Sonnet 5.5 用 auto、關掉思考、提示一定要用工具", async () => {
    const bodies = stub([tool]);
    expect(await callStructured(opts("claude-sonnet-5-5"))).toEqual({ ok: 1 });
    expect(bodies[0].tool_choice.type).toBe("auto");
    expect(bodies[0].thinking).toEqual({ type: "between_tools" });
    expect(bodies[0].system).toContain("report");
  });

  it("第一次只回文字就再問一次", async () => {
    const bodies = stub([[{ type: "text", text: "嗨" }], tool]);
    expect(await callStructured(opts("claude-sonnet-5-5"))).toEqual({ ok: 1 });
    expect(bodies).toHaveLength(2);
  });

  it("Haiku 照舊強制指定工具", async () => {
    const bodies = stub([tool]);
    await callStructured(opts("claude-haiku-5-5"));
    expect(bodies[0].tool_choice).toEqual({ type: "tool", name: "report" });
    expect(bodies[0].thinking).toBeUndefined();
  });
});
