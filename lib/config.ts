// Central settings. Which AI serves each position is set on the AI parts page (lib/slots.ts, lib/providers.ts).

export const config = {
  concurrency: Number(process.env.LLM_CONCURRENCY ?? 3),
  fakeAgents: process.env.VISION_FAKE_AGENTS === "1",
  // "low" | "medium" | "high": how long gpt-oss models reason before answering
  reasoningEffort: process.env.GROQ_REASONING_EFFORT ?? "low",
  parliament: {
    confidenceThreshold: Number(process.env.VISION_CONFIDENCE_TARGET ?? 0.8),
    // Each council round takes a few minutes on Groq's free tier; 2 keeps a demo under ~10 minutes
    maxRounds: Number(process.env.VISION_MAX_ROUNDS ?? 2),
    maxQuestionsPerRound: 5,
  },
  // Each fix round takes ~15-25s; real runs needed 2-3 rounds (one fixes extra required fields, the next a logic bug)
  fixRetries: Number(process.env.VISION_FIX_RETRIES ?? 3),
};
