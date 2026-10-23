// The AI providers Vision can plug in. All speak the OpenAI chat format, so one client serves them all.
// Model lists come from each provider's own /models endpoint, so Vision only ever picks models that exist.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getKey, keyStatus } from "./vault";

export const PROVIDER_IDS = ["groq", "gemini", "nvidia", "mistral"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type Provider = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  envKey: string;
  keyUrl: string;
  goodAt: string;
  // Free-tier limits Vision paces itself under (0 = no limit to pace). Groq's are per model; the others' per account.
  tokensPerMinute: number;
  requestsPerMinute: number;
  limitScope: "model" | "provider";
};

export const PROVIDERS: Record<ProviderId, Provider> = {
  groq: {
    id: "groq",
    name: "Groq",
    baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys",
    goodAt: "Very fast replies: the interview, translating questions, quick council seats",
    tokensPerMinute: Number(process.env.GROQ_TOKENS_PER_MINUTE ?? 8000),
    requestsPerMinute: 30,
    limitScope: "model",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    goodAt: "Reads a lot at once: the head of discussion, head manager, frontend pages",
    tokensPerMinute: 0,
    requestsPerMinute: Number(process.env.GEMINI_REQUESTS_PER_MINUTE ?? 10),
    limitScope: "model",
  },
  nvidia: {
    id: "nvidia",
    name: "NVIDIA (DeepSeek, Kimi, Qwen)",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    envKey: "NVIDIA_API_KEY",
    keyUrl: "https://build.nvidia.com",
    goodAt: "Strong free coders: backend, architect, master prompt",
    tokensPerMinute: 0,
    requestsPerMinute: Number(process.env.NVIDIA_REQUESTS_PER_MINUTE ?? 40),
    limitScope: "provider",
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys",
    goodAt: "Large free allowance: backup for coding and council seats",
    tokensPerMinute: 0,
    requestsPerMinute: Number(process.env.MISTRAL_REQUESTS_PER_MINUTE ?? 50),
    limitScope: "provider",
  },
};

export const isProvider = (id: string): id is ProviderId => (PROVIDER_IDS as readonly string[]).includes(id);

export const providerKey = (id: ProviderId) => getKey(id, PROVIDERS[id].envKey);
export const providerStatus = (id: ProviderId) => keyStatus(id, PROVIDERS[id].envKey);

// ---------- model lists ----------

export type ModelInfo = { id: string; context?: number };

const CACHE = join(process.cwd(), "data", "models-cache.json");
const DAY = 24 * 3_600_000;

// Not chat models, or not useful for writing text
const NOT_CHAT = /embed|rerank|guard|safety|tts|whisper|audio|speech|transcri|image|imagen|veo|vision-instruct|reward|parse|ocr|clip|nemoretriever|detector|aqa|bge|e5-|nv-embed|playai|orpheus|allam/i;

type Cache = Record<string, { at: number; keyLast4: string; models: ModelInfo[] }>;

const g = globalThis as unknown as { __visionModels?: Cache };
function cache(): Cache {
  if (!g.__visionModels) {
    try {
      g.__visionModels = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
    } catch {
      g.__visionModels = {};
    }
  }
  return g.__visionModels!;
}

function saveCache() {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache()));
}

// Asks the provider which models this key can use. Throws with a readable message when the key is wrong.
export async function fetchModels(id: ProviderId, key: string): Promise<ModelInfo[]> {
  const res = await fetch(`${PROVIDERS[id].baseUrl}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`${PROVIDERS[id].name} rejected this key (HTTP ${res.status}). Check that you copied all of it.`);
  if (!res.ok) throw new Error(`${PROVIDERS[id].name} answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { data?: { id: string; context_window?: number; context_length?: number }[] };
  return (data.data ?? [])
    // Gemini lists models as "models/gemini-…"; its chat endpoint takes the bare name
    .map((m) => ({ id: m.id.replace(/^models\//, ""), context: m.context_window ?? m.context_length }))
    .filter((m) => !NOT_CHAT.test(m.id))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

// Cached model list for a provider; refreshed daily or when the key changes. Empty if there's no key.
export async function modelsFor(id: ProviderId): Promise<ModelInfo[]> {
  const key = providerKey(id);
  if (!key) return [];
  const hit = cache()[id];
  if (hit && hit.keyLast4 === key.slice(-4) && Date.now() - hit.at < DAY) return hit.models;
  try {
    const models = await fetchModels(id, key);
    cache()[id] = { at: Date.now(), keyLast4: key.slice(-4), models };
    saveCache();
    return models;
  } catch (err) {
    console.warn(`[providers] couldn't list ${id} models: ${err instanceof Error ? err.message : err}`);
    return hit?.models ?? [];
  }
}

export function forgetModels(id: ProviderId) {
  delete cache()[id];
  saveCache();
}
