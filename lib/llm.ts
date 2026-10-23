// Groq wrapper: every model call in Vision goes through callLLM.
// - asks for JSON and validates it against a zod schema
// - on invalid output, retries once with the validation error
// - on 429 (rate limit) or 5xx, waits and retries
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

// ---------- raw call ----------

async function chat(model: string, messages: Message[], temperature: number, maxTokens: number): Promise<string> {
  if (!config.groqKey) throw new Error("GROQ_API_KEY is not set. Copy .env.example to .env.local and add your key.");

  for (let attempt = 0; attempt < 5; attempt++) {
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
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      console.warn(`[llm] ${model} returned ${res.status}, retrying in ${wait}ms`);
      await sleep(Math.min(wait, 20000));
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
  const { model, system, schema, temperature = 0.3, maxTokens = 4096, label = "llm" } = opts;
  const messages: Message[] = [
    { role: "system", content: `${system}\n\nRespond with a single JSON object only. No prose, no markdown fences.` },
    ...opts.messages,
  ];

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
