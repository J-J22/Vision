// Every model call in Vision goes through callLLM / callText, addressed to a slot (an AI position, see lib/slots.ts).
// - the slot's chain lists the parts that may serve it; the first one free right now takes the call,
//   so work spreads across providers instead of queueing on one
// - paces calls under each provider's free-tier limits (tokens and requests per minute)
// - on a rate limit, daily limit, bad key, missing model or network error, moves on to the next part
// - asks for JSON, validates it against a zod schema, and retries once with the validation error
// - caps how many calls run at once (LLM_CONCURRENCY)
import { z } from "zod";
import { config } from "./config";
import { report } from "./activity";
import { PROVIDERS, providerKey } from "./providers";
import { chainFor, partId, type Part } from "./slots";

export type Message = { role: "system" | "user" | "assistant"; content: string };

type CallOptions<T extends z.ZodTypeAny> = {
  slot: string;
  system: string;
  messages: Message[];
  schema: T;
  temperature?: number;
  maxTokens?: number;
  label?: string; // shows up in logs
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ---------- per-minute pacing ----------

// Rough count: about 3.5 characters per token for English and code
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

type Booking = { at: number; tokens: number };
const g = globalThis as unknown as {
  __visionUsage?: Map<string, Booking[]>;
  __visionOut?: Map<string, number>; // part → when it's usable again after a daily limit
  __visionBadKey?: Map<string, number>; // provider → until
  __visionMissing?: Set<string>; // parts whose model doesn't exist
};
const usage: Map<string, Booking[]> = (g.__visionUsage ??= new Map());
const outForTheDay: Map<string, number> = (g.__visionOut ??= new Map());
const badKey: Map<string, number> = (g.__visionBadKey ??= new Map());
const missing: Set<string> = (g.__visionMissing ??= new Set());

// Groq limits each model separately; the other providers limit the whole account
const scope = (p: Part) => (PROVIDERS[p.provider].limitScope === "model" ? partId(p) : p.provider);

function recent(p: Part): Booking[] {
  const cutoff = Date.now() - 60_000;
  const log = (usage.get(scope(p)) ?? []).filter((b) => b.at > cutoff);
  usage.set(scope(p), log);
  return log;
}

// How long until this request fits the part's per-minute limits (0 = now)
function waitFor(p: Part, tokens: number): number {
  const { tokensPerMinute: tpm, requestsPerMinute: rpm } = PROVIDERS[p.provider];
  const log = recent(p);
  let wait = 0;
  if (tpm) {
    let used = log.reduce((sum, b) => sum + b.tokens, 0);
    for (const b of log) {
      if (used + tokens <= tpm) break;
      used -= b.tokens;
      wait = Math.max(wait, b.at + 60_000 - Date.now() + 250);
    }
  }
  if (rpm && log.length >= rpm) wait = Math.max(wait, log[log.length - rpm].at + 60_000 - Date.now() + 250);
  return Math.max(0, wait);
}

function book(p: Part, tokens: number): Booking {
  const b = { at: Date.now(), tokens };
  recent(p).push(b);
  return b;
}

// Groq rejects any request whose prompt + max output is bigger than its per-minute limit; returns null if it can't fit
function outputBudget(p: Part, promptTokens: number, wanted: number): number | null {
  const tpm = PROVIDERS[p.provider].tokensPerMinute;
  if (!tpm) return wanted;
  const room = tpm - promptTokens - 200;
  return room < 600 ? null : Math.min(wanted, room);
}

// Providers send waits like "7.66s", "1m2.5s" or "120ms"
function parseWait(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  let ms = 0;
  for (const [, n, unit] of value.matchAll(/(\d+(?:\.\d+)?)(ms|m|s|h)/g)) {
    ms += Number(n) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1);
  }
  return ms || null;
}

// ---------- one call, served by the first part that can take it ----------

async function chat(route: string, label: string, messages: Message[], wanted: number, temperature: number, json: boolean): Promise<string> {
  const chain = await chainFor(route);
  if (!chain.length) {
    throw new Error(`No AI is plugged into "${route}" yet. Open the AI parts page and add a key for at least one provider.`);
  }
  const promptTokens = estimateTokens(messages.map((m) => m.content).join("\n"));
  const cooldown = new Map<string, number>(); // part → not before, for this call
  const skip = new Set<string>(); // parts that failed this request in a way a retry won't fix
  const netFails = new Map<string, number>();
  let lastError = "";
  let lastPart = "";
  const started = Date.now();

  for (let failures = 0; failures < 12 && Date.now() - started < 8 * 60_000; ) {
    const now = Date.now();
    const usable = chain.filter(
      (p) => !skip.has(partId(p)) && !missing.has(partId(p)) && (outForTheDay.get(partId(p)) ?? 0) < now && (badKey.get(p.provider) ?? 0) < now && outputBudget(p, promptTokens, wanted) !== null,
    );
    if (!usable.length) {
      throw new Error(
        lastError
          ? `Every AI plugged into "${route}" failed. Last error: ${lastError}`
          : `No AI plugged into "${route}" can take a request this big (about ${promptTokens} tokens). Add Gemini, NVIDIA or Mistral on the AI parts page: they have no per-minute token cap.`,
      );
    }

    // The first part that's free right now, otherwise the one free soonest
    let part = usable[0];
    let bestWait = Infinity;
    for (const p of usable) {
      const maxTokens = outputBudget(p, promptTokens, wanted)!;
      const w = Math.max((cooldown.get(partId(p)) ?? 0) - now, waitFor(p, promptTokens + maxTokens));
      if (w < bestWait) {
        part = p;
        bestWait = w;
      }
      if (w <= 0) break;
    }
    if (bestWait > 0) {
      await sleep(Math.min(bestWait, 60_000));
      continue;
    }

    const id = partId(part);
    if (lastPart && lastPart !== id) report({ slot: route, part: id, event: "switch", detail: `from ${lastPart}` });
    lastPart = id;
    const provider = PROVIDERS[part.provider];
    const maxTokens = outputBudget(part, promptTokens, wanted)!;
    const booking = book(part, promptTokens + maxTokens);
    report({ slot: route, part: id, event: "start" });
    const callStart = Date.now();

    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerKey(part.provider)}` },
        body: JSON.stringify({
          model: part.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          // gpt-oss models reason before answering, and that counts against max_tokens; "low" keeps it short
          ...(part.provider === "groq" && part.model.startsWith("openai/gpt-oss") ? { reasoning_effort: config.reasoningEffort } : {}),
        }),
        // NVIDIA's free models sometimes queue for minutes; a healthy reply comes well inside 45s
        signal: AbortSignal.timeout(part.provider === "nvidia" ? 45_000 : 150_000),
      });
    } catch (err) {
      booking.tokens = 0;
      if ((err as Error).name === "TimeoutError") {
        // Too slow right now: bench it for 10 minutes so the next calls go straight to a spare
        cooldown.set(id, Date.now() + 10 * 60_000);
        lastError = `${id} took too long to answer`;
        report({ slot: route, part: id, event: "error", detail: "timed out" });
        console.warn(`[llm] ${label}: ${lastError}, benched for 10 min`);
        failures++;
        continue;
      }
      // Dropped Wi-Fi, DNS hiccup or a stalled connection: nothing was used
      const n = (netFails.get(id) ?? 0) + 1;
      netFails.set(id, n);
      cooldown.set(id, Date.now() + Math.min(1500 * 2 ** n, 30_000));
      lastError = `${provider.name} network error (${(err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).name})`;
      console.warn(`[llm] ${label}: ${lastError}`);
      failures++;
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      booking.tokens = 0;
      report({ slot: route, part: id, event: "error", detail: `HTTP ${res.status}` });
      if (res.status === 429 && /per day|\(TPD\)|\(RPD\)|daily|quota/i.test(body)) {
        // A daily limit won't clear for hours: this part is out until it resets
        const wait = parseWait(res.headers.get("retry-after")) ?? 3_600_000;
        outForTheDay.set(id, Date.now() + wait);
        lastError = `${id} used up its daily allowance`;
        console.warn(`[llm] ${label}: ${lastError} (back in ~${Math.round(wait / 60000)} min)`);
      } else if (res.status === 429 || res.status >= 500) {
        const wait = parseWait(res.headers.get("retry-after")) ?? parseWait(res.headers.get("x-ratelimit-reset-tokens")) ?? 2000;
        // Providers sometimes say "retry in 1ms"; retrying that fast just gets blocked again
        cooldown.set(id, Date.now() + Math.min(Math.max(wait, 2000), 60_000));
        lastError = `${id} returned ${res.status}`;
        console.warn(`[llm] ${label}: ${lastError}, trying another part or waiting`);
      } else if (res.status === 401 || res.status === 403) {
        badKey.set(part.provider, Date.now() + 10 * 60_000);
        lastError = `${provider.name} rejected the key (HTTP ${res.status})`;
        console.warn(`[llm] ${label}: ${lastError}`);
      } else if (res.status === 404) {
        missing.add(id);
        lastError = `${id} doesn't exist for this key`;
        console.warn(`[llm] ${label}: ${lastError}`);
      } else if (res.status === 400 && json) {
        // JSON mode is rejected by some models, or the model produced invalid JSON in it:
        // retry in plain mode, since callers can pull JSON out of a slightly messy reply
        console.warn(`[llm] ${label}: ${id} rejected JSON mode, retrying without it`);
        json = false;
      } else {
        skip.add(id);
        lastError = `${id} returned ${res.status}: ${body.slice(0, 300)}`;
        console.warn(`[llm] ${label}: ${lastError}`);
      }
      failures++;
      continue;
    }

    const data = await res.json();
    // The booking assumed the longest possible answer; replace it with the real count
    const total = data.usage?.total_tokens;
    if (total) booking.tokens = total;
    report({ slot: route, part: id, event: "done", tokens: total, ms: Date.now() - callStart });
    console.log(`[llm] ${label} ok (${id}, ${Date.now() - callStart}ms)`);
    return data.choices?.[0]?.message?.content ?? "";
  }
  throw new Error(`Couldn't get an answer for "${route}" after several tries. ${lastError ? `Last error: ${lastError}.` : ""} Check the internet connection, or add another provider on the AI parts page.`);
}

// Some models wrap JSON in prose or <think> blocks; pull out the outermost object.
function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
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
  const { slot, system, schema, temperature = 0.3, label = slot } = opts;
  const messages: Message[] = [
    { role: "system", content: `${system}\n\nRespond with a single JSON object only. No prose, no markdown fences.` },
    ...opts.messages,
  ];
  await acquire();
  try {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chat(slot, label, messages, opts.maxTokens ?? 4096, temperature, true);
      try {
        return schema.parse(extractJson(raw));
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

// Plain-text call with the same routing, pacing and retries as callLLM, without schema validation.
// Used by the master prompt and the debate relay, where crossexam does its own parsing.
export async function callText(opts: { slot: string; messages: Message[]; maxTokens?: number; temperature?: number; json?: boolean; label?: string }) {
  const { slot, messages, temperature = 0.4, json = false, label = slot } = opts;
  await acquire();
  try {
    const text = await chat(slot, label, messages, opts.maxTokens ?? 1500, temperature, json);
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } finally {
    release();
  }
}

