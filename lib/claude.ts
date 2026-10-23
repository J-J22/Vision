// Claude through Anthropic's official SDK. The other providers share the OpenAI chat format; Claude doesn't,
// so lib/llm.ts sends Claude parts here. Results and errors come back as a fetch Response in that same format,
// which lets the wrapper's existing handling (rate limits, daily limits, bad keys, spares) work unchanged.
import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "./llm";

// The positions where a better answer is worth more thinking; everything else answers at low effort for speed
const DEEP = new Set(["master", "backend", "manager", "frontend", "theme"]);

const clients = new Map<string, Anthropic>();
function client(key: string) {
  let c = clients.get(key);
  if (!c) {
    // Vision retries and switches to spares itself
    c = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 150_000 });
    clients.set(key, c);
  }
  return c;
}

export async function claudeModels(key: string): Promise<{ id: string; context?: number }[]> {
  const out: { id: string; context?: number }[] = [];
  for await (const m of client(key).models.list()) out.push({ id: m.id, context: m.max_input_tokens ?? undefined });
  return out;
}

export async function claudeChat(opts: { key: string; model: string; route: string; messages: Message[]; maxTokens: number; json: boolean }): Promise<Response> {
  const system = [
    ...opts.messages.filter((m) => m.role === "system").map((m) => m.content),
    ...(opts.json ? ["Reply with only the JSON object: no prose before or after it, no code fences."] : []),
  ].join("\n\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "Go ahead." });

  try {
    const res = await client(opts.key).beta.messages.create({
      model: opts.model,
      // Thinking is always on and counts against max_tokens; leave room so answers aren't cut off.
      // Only the tokens actually used are billed.
      max_tokens: Math.min(opts.maxTokens + 8000, 32000),
      output_config: { effort: DEEP.has(opts.route) ? "medium" : "low" },
      // If a safety check declines a request, the API reruns it on a suitable model instead of stopping
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...(system ? { system } : {}),
      messages,
    });
    if (res.stop_reason === "refusal") {
      return Response.json({ error: { message: "Claude declined this request" } }, { status: 422 });
    }
    const content = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const total = res.usage.input_tokens + res.usage.output_tokens;
    return Response.json({ choices: [{ message: { content } }], usage: { total_tokens: total } });
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      const timeout = new Error("Claude took too long");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    if (err instanceof Anthropic.APIError && err.status) {
      return new Response(JSON.stringify(err.error ?? { message: err.message }), { status: err.status, headers: err.headers ?? undefined });
    }
    throw err;
  }
}
