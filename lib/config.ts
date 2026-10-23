// Central place for model names and limits. Override any of these in .env.local.

function list(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

export const config = {
  groqKey: process.env.GROQ_API_KEY ?? "",
  groqBaseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  models: {
    big: process.env.GROQ_MODEL_BIG ?? "llama-3.3-70b-versatile",
    small: process.env.GROQ_MODEL_SMALL ?? "llama-3.1-8b-instant",
    parliament: list(process.env.GROQ_PARLIAMENT_MODELS, [
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
      "qwen/qwen3-32b",
      "llama-3.1-8b-instant",
    ]),
  },
  concurrency: Number(process.env.LLM_CONCURRENCY ?? 3),
  fakeAgents: process.env.VISION_FAKE_AGENTS === "1",
  parliament: {
    confidenceThreshold: 0.8,
    maxRounds: 3,
    maxQuestionsPerRound: 5,
  },
  fixRetries: 1,
};
