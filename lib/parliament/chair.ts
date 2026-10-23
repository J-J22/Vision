// The chair merges the members' reviews into a short list of questions; the translator words them for the user.
import { z } from "zod";
import { callLLM } from "../llm";
import type { Level, MemberReview, UserQuestion } from "../types";

const ChairSchema = z.object({
  questions: z
    .array(z.object({ area: z.string().default("features"), question: z.string(), why: z.string().default(""), blocking: z.boolean().default(false) }))
    .default([]),
  defaults: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
});
export type ChairResult = z.infer<typeof ChairSchema>;

export async function chair(reviews: MemberReview[], asked: { question: string; answer: string }[], maxQuestions: number): Promise<ChairResult> {
  return callLLM({
    label: "parliament chair",
    slot: "head",
    schema: ChairSchema,
    system: `You chair a review panel for a web app plan. Members raised the concerns below.
1. Merge duplicates. Drop anything already answered.
2. Keep at most ${maxQuestions} questions that most change what gets built; blocking ones first. Mark "blocking": true only if building without the answer would likely be wrong.
3. Turn every other concern into a sensible default, written as a plain sentence ("Sellers can list up to 20 photos").
4. "disagreements": where members disagreed, one line each (can be empty).
Return {"questions": [{"area": "", "question": "", "why": "", "blocking": true}], "defaults": [], "disagreements": []}`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          reviews: reviews.filter((r) => !r.error).map((r) => ({ member: r.role, summary: r.summary, concerns: r.concerns })),
          alreadyAsked: asked,
        }),
      },
    ],
  });
}

const TranslatedSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      why: z.string().default(""),
      options: z.array(z.object({ label: z.string(), recommended: z.boolean().optional() })).min(2).max(5),
    }),
  ),
});

const LEVEL_GUIDE: Record<Level, string> = {
  beginner: "The user is not technical. No jargon at all: explain with everyday examples (e.g. 'like how eBay holds the money until...').",
  "some-tech": "The user knows some tech. Light technical terms are fine if you explain them briefly.",
  developer: "The user is a developer. Be precise and technical; name the actual technologies and patterns.",
};

export async function translate(
  questions: ChairResult["questions"],
  level: Level,
  appSummary: string,
  round: number,
): Promise<UserQuestion[]> {
  if (!questions.length) return [];
  const result = await callLLM({
    label: "parliament translator",
    slot: "translator",
    schema: TranslatedSchema,
    temperature: 0.4,
    system: `Rewrite each question for this user. ${LEVEL_GUIDE[level]}
For each question give 2-4 short answer options and mark exactly one as "recommended": true (the best choice for a first version).
"why": one short sentence on why this matters to their app. Keep the same order and the same number of questions.
Return {"questions": [{"text": "", "why": "", "options": [{"label": "", "recommended": true}, {"label": ""}]}]}`,
    messages: [{ role: "user", content: JSON.stringify({ app: appSummary, questions: questions.map((q) => ({ question: q.question, why: q.why })) }) }],
  });
  return questions.map((q, i) => {
    const t = result.questions[i];
    return {
      id: `r${round}q${i + 1}`,
      area: q.area,
      text: t?.text ?? q.question,
      why: t?.why ?? q.why,
      options: t?.options ?? [{ label: "Yes", recommended: true }, { label: "No" }],
    };
  });
}
