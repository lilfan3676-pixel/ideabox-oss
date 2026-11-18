import "server-only";
import { env } from "./env";

// 直接呼叫 Anthropic Messages API（不依賴 SDK 版本）。

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };

export type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type ApiResponse = {
  content: ContentBlock[];
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
};

/** 每次呼叫後記錄用量與費用（給成本總覽用）；記錄失敗不影響主流程 */
async function logUsage(model: string, purpose: string, usage: ApiResponse["usage"]) {
  try {
    const { usdCost, purposeProduct } = await import("./costCalc");
    const { db } = await import("./db");
    const u = usage as Parameters<typeof usdCost>[1];
    await db().from("ai_usage").insert({
      model,
      purpose,
      product: purposeProduct(purpose),
      input_tokens: u?.input_tokens ?? 0,
      output_tokens: u?.output_tokens ?? 0,
      web_searches: u?.server_tool_use?.web_search_requests ?? 0,
      usd: Math.round(usdCost(model, u) * 1_000_000) / 1_000_000,
    });
  } catch {
    // 忽略
  }
}

export async function callClaude(body: Record<string, unknown>, timeoutMs = 120_000, purpose = "other"): Promise<ApiResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.anthropicKey(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as ApiResponse;
    await logUsage(String(body.model ?? ""), purpose, json.usage);
    return json;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 不需要思考的請求（整理、描述資料）用的 thinking 設定：Haiku 5.5、Sonnet 5.5 預設會先思考，
 * 會吃掉 max_tokens，額度小時結果沒有文字或被截斷。Haiku 5.5 用 disabled（effort 預設 medium 時可用）；
 * Sonnet 5.5 不接受 disabled，要用 between_tools。其他模型不帶。
 */
export function noThinking(model: string): Record<string, unknown> {
  if (/^claude-sonnet-5-5/.test(model)) return { thinking: { type: "between_tools" } };
  if (/^claude-haiku-5-5/.test(model)) return { thinking: { type: "disabled" } };
  return {};
}

// 這些模型不接受強制指定工具（tool_choice 的 tool／any 會回 400），改成 auto＋提示一定要用
const NO_FORCED_TOOL = /^claude-(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)/;
export const canForceTool = (model: string) => !NO_FORCED_TOOL.test(model);

/** 要模型呼叫指定工具，回傳工具輸入（即結構化 JSON）。 */
export async function callStructured<T>(opts: {
  model: string;
  system: string;
  content: string | ContentBlock[];
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  purpose?: string;
}): Promise<T> {
  const force = canForceTool(opts.model);
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: force ? opts.system : `${opts.system}\n\n請只用 ${opts.toolName} 工具回傳結果，不要另外寫文字。`,
    messages: [{ role: "user", content: opts.content }],
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema }],
    tool_choice: force ? { type: "tool", name: opts.toolName } : { type: "auto", disable_parallel_tool_use: true },
  };
  // Sonnet 5.5 預設會先思考、吃掉 max_tokens；整理資料不需要，關掉（between_tools）
  if (/^claude-sonnet-5-5/.test(opts.model)) body.thinking = { type: "between_tools" };
  // 沒有強制時偶爾會直接回文字：再問一次
  for (let attempt = 0; attempt < (force ? 1 : 2); attempt++) {
    const res = await callClaude(body, 120_000, opts.purpose ?? "other");
    const block = res.content.find((b) => b.type === "tool_use" && (b as { name?: string }).name === opts.toolName);
    if (block) return (block as { input: T }).input;
  }
  throw new Error("模型沒有回傳結構化結果");
}

export function textOf(res: ApiResponse): string {
  return res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
