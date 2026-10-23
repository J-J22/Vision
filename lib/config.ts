// Central place for model names and limits. Override any of these in .env.local.

function list(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

export const config = {
  groqKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  models: {
    big: process.env.GROQ_MODEL_BIG ?? "openai/gpt-oss-120b",
    small: process.env.GROQ_MODEL_SMALL ?? "openai/gpt-oss-20b",
    parliament: list(process.env.GROQ_PARLIAMENT_MODELS, [
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
    ]),
  },
  // Which model each build agent uses. Groq limits are per model, so spreading agents across models is faster.
  agentModels: {
    planner: process.env.GROQ_MODEL_PLANNER ?? "openai/gpt-oss-20b",
    backend: process.env.GROQ_MODEL_BACKEND ?? "openai/gpt-oss-120b",
    // Comma-separated: frontend tasks take turns across these models, since pages are long and fill one model's per-minute limit
    frontend: list(process.env.GROQ_MODEL_FRONTEND, ["qwen/qwen3.8-27b", "openai/gpt-oss-20b"]),
    qa: process.env.GROQ_MODEL_QA ?? "openai/gpt-oss-20b",
  },
  concurrency: Number(process.env.LLM_CONCURRENCY ?? 3),
  // Groq's free tier allows 8,000 tokens per minute per model; raise this on a paid tier
  tokensPerMinute: Number(process.env.GROQ_TOKENS_PER_MINUTE ?? 8000),
  fakeAgents: process.env.VISION_FAKE_AGENTS === "1",
  parliament: {
    confidenceThreshold: 0.8,
    maxRounds: 3,
    maxQuestionsPerRound: 5,
  },
  fixRetries: 1,
};
