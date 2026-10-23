// Groq wrapper: every model call in Vision goes through callLLM.
// - asks for JSON and validates it against a zod schema
// - on invalid output, retries once with the validation error
// - paces calls to stay under each model's tokens-per-minute limit
// - on 429 (rate limit) or 5xx, waits as long as Groq asks and retries
// - caps how many calls run at once (LLM_CONCURRENCY)
import { z } from "zod";
import { config } from "./config";

export type Message = { role: "system" | "user" | "assistant"; content: string };

type CallOptions<T extends z.ZodTypeAny> = {
  model: string;
  system: string;
  messages: Message[];
  schema: T;
  temperature?: number;
  maxTokens?: number;
  label?: string; // shows up in logs
};

// ---------- concurrency limit ----------

let active = 0;
const queue: (() => void)[] = [];

async function acquire() {
  if (active < config.concurrency) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active++;
}

function release() {
  active--;
  queue.shift()?.();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- tokens-per-minute pacing ----------

// Rough count: about 3.5 characters per token for English and code
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

const g = globalThis as unknown as { __visionTokenLog?: Map<string, { at: number; tokens: number }[]> };
const tokenLog: Map<string, { at: number; tokens: number }[]> = (g.__visionTokenLog ??= new Map());

function usedLastMinute(model: string) {
  const cutoff = Date.now() - 60_000;
  const log = (tokenLog.get(model) ?? []).filter((e) => e.at > cutoff);
  tokenLog.set(model, log);
  return log.reduce((sum, e) => sum + e.tokens, 0);
}

// Waits until this request fits in the model's per-minute budget, then books it
async function reserve(model: string, tokens: number) {
  while (usedLastMinute(model) + tokens > config.tokensPerMinute) {
    const oldest = tokenLog.get(model)?.[0];
    await sleep(oldest ? Math.max(500, oldest.at + 60_000 - Date.now() + 250) : 1000);
  }
  tokenLog.get(model)!.push({ at: Date.now(), tokens });
}

// Groq sends waits like "7.66s", "1m2.5s" or "120ms"
function parseWait(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  let ms = 0;
  for (const [, n, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|m|s|h)/g)) {
    ms += Number(n) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
  }
  return ms || null;
}

// ---------- raw call ----------

async function chat(model: string, messages: Message[], temperature: number, maxTokens: number): Promise<string> {
  if (!config.groqKey) throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env.local and add your key.");

  for (let attempt = 0; attempt < 8; attempt++) {
    await reserve(model, estimateTokens(messages.map((m) => m.content).join("\n")) + maxTokens);
    const res = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.groqKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429 || res.status >= 500) {
      const wait =
        parseWait(res.headers.get("retry-after")) ??
        parseWait(res.headers.get("x-ratelimit-reset-tokens")) ??
        1000 * 2 ** attempt;
      console.warn(`[llm] ${model} returned ${res.status}, retrying in ${Math.round(wait)}ms`);
      await sleep(Math.min(wait + 250, 60_000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq ${res.status} for model ${model}: ${body.slice(0, 500)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
  throw new Error(`Groq kept rate-limiting model ${model}; try again in a minute or lower LLM_CONCURRENCY.`);
}

// Some models wrap JSON in prose or <think> blocks; pull out the outermost object.
function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Response was not JSON");
  }
}

// ---------- public API ----------

export async function callLLM<T extends z.ZodTypeAny>(opts: CallOptions<T>): Promise<z.infer<T>> {
  const { model, system, schema, temperature = 0.3, label = "llm" } = opts;
  const messages: Message[] = [
    { role: "system", content: `${system}\n\nRespond with a single JSON object only. No prose, no markdown fences.` },
    ...opts.messages,
  ];

  // Groq rejects any request whose prompt + max output is bigger than the per-minute limit,
  // so shrink the output budget to fit, and fail clearly if the prompt alone is too big
  const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
  const room = config.tokensPerMinute - promptTokens - 200;
  if (room < 800) {
    throw new Error(`${label}: prompt is about ${promptTokens} tokens, too big for the ${config.tokensPerMinute} tokens/minute limit. Send less context.`);
  }
  const maxTokens = Math.min(opts.maxTokens ?? 4096, room);

  await acquire();
  try {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      const raw = await chat(model, messages, temperature, maxTokens);
      try {
        const parsed = schema.parse(extractJson(raw));
        console.log(`[llm] ${label} ok (${model}, ${Date.now() - started}ms)`);
        return parsed;
      } catch (err) {
        lastError = err instanceof z.ZodError ? JSON.stringify(err.issues.slice(0, 5)) : String(err);
        console.warn(`[llm] ${label} invalid output, attempt ${attempt + 1}: ${lastError.slice(0, 300)}`);
        messages.push(
          { role: "assistant", content: raw.slice(0, 4000) },
          { role: "user", content: `That output was invalid: ${lastError}. Return corrected JSON only.` },
        );
      }
    }
    throw new Error(`${label}: model output failed validation twice. Last error: ${lastError}`);
  } finally {
    release();
  }
}
