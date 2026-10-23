// AI positions ("slots") in Vision's flow. Any model can sit in any slot; each slot recommends parts and
// warns when the chosen one is underpowered. A slot runs its chain in order: the user's pick (if any),
// then the recommended parts, then Groq spares. A part is "provider:model".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isProvider, modelsFor, PROVIDERS, providerKey, type ModelInfo, type ProviderId } from "./providers";

export type Stage = "discovery" | "council" | "master" | "build";
export type Spec = { coding?: number; reasoning?: number; speed?: number; context?: number };
type Pref = { provider: ProviderId; match: string | RegExp };

export type SlotDef = {
  id: string;
  stage: Stage;
  title: string;
  job: string;
  needs: Spec;
  typicalPrompt: number; // tokens a typical call sends, used to check per-minute limits
  prefer: Pref[];
};

// Reusable preferences, newest version first (model lists are sorted that way)
const P = {
  groq120: { provider: "groq", match: "openai/gpt-oss-120b" },
  groq20: { provider: "groq", match: "openai/gpt-oss-20b" },
  groqQwen: { provider: "groq", match: "qwen/qwen3.8-27b" },
  // Pinned (2026-10-24): gemini-flash-latest / 3.8-flash hang for minutes on the free tier and 3.7 is overloaded; 3.6 answers in ~2s
  geminiFlash: { provider: "gemini", match: /^gemini-3\.6-flash$|^gemini-3\.5-flash$/ },
  deepseekPro: { provider: "nvidia", match: /deepseek-ai\/deepseek-v4.*pro|deepseek-ai\/deepseek-v[34]/i },
  deepseekFlash: { provider: "nvidia", match: /deepseek-ai\/deepseek-v4.*flash|deepseek-ai\/deepseek-v[34]/i },
  kimi: { provider: "nvidia", match: /moonshotai\/kimi-k2/i },
  qwenCoder: { provider: "nvidia", match: /qwen.*coder/i },
  mistralLarge: { provider: "mistral", match: /^mistral-large-latest$|^mistral-medium-latest$/ },
  codestral: { provider: "mistral", match: /^codestral-latest$/ },
  mistralSmall: { provider: "mistral", match: /^mistral-small-latest$/ },
  // Cerebras serves the same open models as Groq (separate quota); SambaNova has DeepSeek
  cerebras120: { provider: "cerebras", match: "gpt-oss-120b" },
  cerebrasQwen: { provider: "cerebras", match: /^qwen-?3\.8-27b$/ },
  sambaDeepseek: { provider: "sambanova", match: /^DeepSeek-V3\.2$|^DeepSeek-V3/ },
  // Paid: first for the master prompt, planner (API contract) and backend; a last-resort spare everywhere else (SPARES)
  claude: { provider: "anthropic", match: "claude-opus-5-5" },
} satisfies Record<string, Pref>;

export const SLOTS: SlotDef[] = [
  { id: "intake", stage: "discovery", title: "Questioning agent", job: "Interviews the user, one question at a time", needs: { speed: 4, reasoning: 2 }, typicalPrompt: 2500, prefer: [P.groqQwen, P.cerebrasQwen, P.groq20, P.geminiFlash, P.mistralSmall] },
  { id: "draft", stage: "discovery", title: "Draft writer", job: "Turns the interview into the first plan", needs: { reasoning: 4 }, typicalPrompt: 1500, prefer: [P.groq120, P.cerebras120, P.deepseekPro, P.sambaDeepseek, P.geminiFlash, P.mistralLarge] },
  { id: "merge", stage: "discovery", title: "Answer merger", job: "Folds the user's answers into the plan", needs: { reasoning: 3 }, typicalPrompt: 4000, prefer: [P.groqQwen, P.cerebrasQwen, P.geminiFlash, P.groq120, P.cerebras120, P.mistralLarge] },
  { id: "seat-architect", stage: "council", title: "Architect seat", job: "Reviews data, API, scale", needs: { reasoning: 4 }, typicalPrompt: 3000, prefer: [P.deepseekPro, P.sambaDeepseek, P.groq120, P.cerebras120, P.geminiFlash] },
  { id: "seat-product", stage: "council", title: "Product seat", job: "Reviews users, features, journeys", needs: { reasoning: 3 }, typicalPrompt: 3000, prefer: [P.geminiFlash, P.groqQwen, P.cerebrasQwen, P.mistralLarge] },
  { id: "seat-security", stage: "council", title: "Security seat", job: "Reviews login, permissions, money", needs: { reasoning: 4 }, typicalPrompt: 3000, prefer: [P.groq120, P.cerebras120, P.mistralLarge, P.deepseekPro, P.sambaDeepseek] },
  { id: "seat-skeptic", stage: "council", title: "Skeptic seat", job: "Hunts contradictions and edge cases", needs: { reasoning: 3 }, typicalPrompt: 3000, prefer: [P.kimi, P.groq20, P.mistralLarge] },
  { id: "seat-designer", stage: "council", title: "Designer seat", job: "Reviews screens, flow, look", needs: { reasoning: 3 }, typicalPrompt: 3000, prefer: [P.groqQwen, P.cerebrasQwen, P.geminiFlash, P.mistralSmall] },
  { id: "head", stage: "council", title: "Head of discussion", job: "Reads the whole debate and writes the outcome", needs: { reasoning: 4, context: 32000 }, typicalPrompt: 6000, prefer: [P.geminiFlash, P.deepseekPro, P.sambaDeepseek, P.groq120, P.cerebras120] },
  { id: "translator", stage: "council", title: "Translator", job: "Rewords questions for the user's level", needs: { speed: 3 }, typicalPrompt: 1500, prefer: [P.groq20, P.groqQwen, P.cerebrasQwen, P.geminiFlash] },
  { id: "panel", stage: "council", title: "Backup review panel", job: "Reviews the plan if the debate can't run", needs: { reasoning: 3 }, typicalPrompt: 3000, prefer: [P.groq20, P.groqQwen, P.cerebrasQwen, P.geminiFlash, P.mistralSmall] },
  { id: "master", stage: "master", title: "Master prompt writer", job: "Writes the spec the build team follows", needs: { reasoning: 4, context: 16000 }, typicalPrompt: 3000, prefer: [P.claude, P.deepseekPro, P.sambaDeepseek, P.geminiFlash, P.groq120, P.cerebras120] },
  { id: "manager", stage: "build", title: "Head manager", job: "Splits the work into tasks", needs: { reasoning: 4 }, typicalPrompt: 3000, prefer: [P.claude, P.geminiFlash, P.groq120, P.cerebras120, P.groq20] },
  { id: "backend", stage: "build", title: "Backend developer", job: "Writes the database and API", needs: { coding: 4 }, typicalPrompt: 4500, prefer: [P.claude, P.kimi, P.deepseekPro, P.sambaDeepseek, P.codestral, P.qwenCoder, P.groqQwen, P.cerebrasQwen] },
  { id: "theme", stage: "build", title: "Designer", job: "Writes the app's theme: colors, fonts, light and dark", needs: { coding: 3 }, typicalPrompt: 2500, prefer: [P.claude, P.geminiFlash, P.codestral, P.groqQwen, P.cerebrasQwen] },
  { id: "frontend", stage: "build", title: "Frontend developer", job: "Writes the pages", needs: { coding: 3 }, typicalPrompt: 4000, prefer: [P.geminiFlash, P.deepseekFlash, P.sambaDeepseek, P.codestral, P.groqQwen, P.cerebrasQwen, P.groq20] },
  { id: "qa", stage: "build", title: "QA tester", job: "Explains failed tests and what to fix", needs: { reasoning: 4 }, typicalPrompt: 3000, prefer: [P.groq120, P.cerebras120, P.geminiFlash, P.groq20] },
];

export type SlotId = string;
export const isSlot = (id: string) => SLOTS.some((s) => s.id === id);
const slotDef = (id: string) => SLOTS.find((s) => s.id === id);

// Always-available spares when Groq is plugged in, so a slot never runs dry
const SPARES = ["groq:qwen/qwen3.8-27b", "cerebras:qwen-3.8-27b", "groq:openai/gpt-oss-20b", "groq:openai/gpt-oss-120b", "cerebras:gpt-oss-120b", "sambanova:DeepSeek-V3.2", "anthropic:claude-opus-5-5"];

// ---------- part ratings (Vision's own judgment, 1–5; not benchmarks) ----------

type Rating = { coding: number; reasoning: number; speed: number; context?: number };
const RATINGS: [RegExp, Rating][] = [
  [/claude-opus/i, { coding: 5, reasoning: 5, speed: 3, context: 1000000 }],
  [/claude-sonnet/i, { coding: 5, reasoning: 5, speed: 4, context: 1000000 }],
  [/claude-haiku/i, { coding: 4, reasoning: 4, speed: 5, context: 1000000 }],
  [/gpt-oss-120b/, { coding: 3, reasoning: 4, speed: 5 }],
  [/gpt-oss-20b/, { coding: 2, reasoning: 3, speed: 5 }],
  [/qwen-?3\.8-27b/, { coding: 3, reasoning: 3, speed: 4 }],
  [/deepseek.*v4.*pro/i, { coding: 5, reasoning: 5, speed: 2, context: 128000 }],
  [/deepseek.*v4.*flash/i, { coding: 4, reasoning: 4, speed: 4, context: 128000 }],
  [/deepseek/i, { coding: 4, reasoning: 4, speed: 3, context: 128000 }],
  [/kimi-k2/i, { coding: 5, reasoning: 4, speed: 3, context: 128000 }],
  [/qwen.*coder/i, { coding: 4, reasoning: 3, speed: 3, context: 128000 }],
  [/gemini.*flash-lite/i, { coding: 2, reasoning: 3, speed: 5, context: 1000000 }],
  [/gemini.*flash/i, { coding: 4, reasoning: 4, speed: 4, context: 1000000 }],
  [/gemini.*pro/i, { coding: 5, reasoning: 5, speed: 2, context: 1000000 }],
  [/codestral/i, { coding: 4, reasoning: 3, speed: 4, context: 128000 }],
  [/mistral-large|mistral-medium/i, { coding: 4, reasoning: 4, speed: 3, context: 128000 }],
  [/mistral-small|ministral/i, { coding: 2, reasoning: 3, speed: 4, context: 128000 }],
  [/llama.*(70b|405b|maverick)/i, { coding: 3, reasoning: 3, speed: 3 }],
  [/llama/i, { coding: 2, reasoning: 2, speed: 4 }],
];

export function ratingOf(model: string, context?: number): Rating | null {
  const hit = RATINGS.find(([re]) => re.test(model));
  if (!hit) return null;
  return { ...hit[1], context: context ?? hit[1].context };
}

// ---------- parts ----------

export type Part = { provider: ProviderId; model: string };
export const partId = (p: Part) => `${p.provider}:${p.model}`;
export function parsePart(id: string): Part | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const provider = id.slice(0, i);
  const model = id.slice(i + 1);
  return isProvider(provider) && model ? { provider, model } : null;
}

// ---------- the user's choices (data/slots.json) ----------

const CHOICES = join(process.cwd(), "data", "slots.json");

export function readChoices(): Record<string, string> {
  try {
    return existsSync(CHOICES) ? JSON.parse(readFileSync(CHOICES, "utf8")) : {};
  } catch {
    return {};
  }
}

export function setChoice(slot: string, part: string | null) {
  const choices = readChoices();
  if (part) choices[slot] = part;
  else delete choices[slot];
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  writeFileSync(CHOICES, JSON.stringify(choices, null, 1));
}

// ---------- resolving a slot to parts ----------

async function resolvePref(pref: Pref): Promise<Part | null> {
  const models = await modelsFor(pref.provider);
  const hit = typeof pref.match === "string" ? models.find((m) => m.id === pref.match) : models.find((m) => (pref.match as RegExp).test(m.id));
  return hit ? { provider: pref.provider, model: hit.id } : null;
}

// The recommended parts for a slot, among the providers that have a key
export async function recommended(slot: string): Promise<Part[]> {
  const def = slotDef(slot);
  if (!def) return [];
  const parts = dedupe((await Promise.all(def.prefer.map(resolvePref))).filter((p): p is Part => Boolean(p)));
  // Last resort only: tested 2026-10-24, NVIDIA's free DeepSeek/GLM/gpt-oss gave no answer within 45s
  // and Kimi K2.6 wasn't served, so putting it first cost every call 45s before a spare took over
  return [...parts.filter((p) => !SLOW_PROVIDERS.has(p.provider)), ...parts.filter((p) => SLOW_PROVIDERS.has(p.provider))];
}

const SLOW_PROVIDERS = new Set<string>(["nvidia"]);

function dedupe(parts: Part[]): Part[] {
  const seen = new Set<string>();
  return parts.filter((p) => !seen.has(partId(p)) && seen.add(partId(p)));
}

// Everything a call to `route` may use, in order. `route` is a slot id, or a "provider:model" part.
export async function chainFor(route: string): Promise<Part[]> {
  const direct = parsePart(route);
  if (direct) return [direct];
  const chosen = parsePart(readChoices()[route] ?? "");
  const spares = SPARES.map(parsePart).filter((p): p is Part => Boolean(p));
  return dedupe([...(chosen ? [chosen] : []), ...(await recommended(route)), ...spares]).filter((p) => Boolean(providerKey(p.provider)));
}

// ---------- compatibility check ----------

export type Verdict = { level: "ok" | "bottleneck" | "wont-fit" | "unknown"; text: string };
const DIMENSIONS: (keyof Omit<Spec, "context">)[] = ["coding", "reasoning", "speed"];

export function verdict(slot: string, part: Part, info?: ModelInfo): Verdict {
  const def = slotDef(slot);
  if (!def) return { level: "unknown", text: "Unknown position" };
  const provider = PROVIDERS[part.provider];
  // Hard limits first: these are facts from the provider, not opinions
  if (provider.tokensPerMinute && def.typicalPrompt + 800 > provider.tokensPerMinute) {
    return { level: "wont-fit", text: `One call here sends about ${def.typicalPrompt.toLocaleString()} tokens; ${provider.name}'s free tier allows ${provider.tokensPerMinute.toLocaleString()} per minute.` };
  }
  const rating = ratingOf(part.model, info?.context);
  if (rating?.context && def.needs.context && rating.context < def.needs.context) {
    return { level: "wont-fit", text: `This position reads about ${def.needs.context.toLocaleString()} tokens at once; this model holds ${rating.context.toLocaleString()}.` };
  }
  if (!rating) return { level: "unknown", text: "Unrated part: Vision hasn't tested this model. It will run, but results may vary." };
  const short = DIMENSIONS.filter((d) => def.needs[d] && rating[d] < def.needs[d]!).map((d) => `${d[0].toUpperCase()}${d.slice(1)} ${rating[d]}/5 (needs ${def.needs[d]})`);
  if (short.length) return { level: "bottleneck", text: `Not enough power for this position: ${short.join(", ")}. It will run, but expect weaker results.` };
  return { level: "ok", text: "Meets everything this position needs." };
}
