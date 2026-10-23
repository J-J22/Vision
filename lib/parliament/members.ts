// Parliament members: each reviews the Blueprint from one angle, using a different model.
import { z } from "zod";
import { callLLM } from "../llm";
import { AREAS, ConcernSchema, type Blueprint, type MemberReview, type MemberRole } from "../types";

export const MEMBERS: { role: MemberRole; title: string; focus: string }[] = [
  {
    role: "architect",
    title: "Architect",
    focus: "the data model, API endpoints, how pages get their data, expected scale and hosting. Look for missing entities, relationships and endpoints.",
  },
  {
    role: "product",
    title: "Product lead",
    focus: "who the users are, what each role can do, which features are in the first version, and the key pages and user journeys. Look for vague features and missing roles.",
  },
  {
    role: "security",
    title: "Security & payments",
    focus: "login, who may do what, if the app handles money: how it moves (checkout, fees, payouts, refunds), fraud, fake content, privacy and legal basics.",
  },
  {
    role: "skeptic",
    title: "Skeptic",
    focus: "contradictions, unrealistic scope for a first version, edge cases (sold-out items, disputes, cancellations) and anything the others would miss.",
  },
];

const ReviewSchema = z.object({
  summary: z.string().default(""),
  concerns: z.array(ConcernSchema).default([]),
  scores: z.record(z.string(), z.coerce.number()).default({}),
});

export async function review(
  member: (typeof MEMBERS)[number],
  model: string,
  blueprint: Blueprint,
  history: { asked: { question: string; answer: string }[]; defaults: string[] },
): Promise<MemberReview> {
  try {
    const result = await callLLM({
      label: `parliament ${member.role}`,
      slot: model,
      schema: ReviewSchema,
      temperature: 0.5,
      maxTokens: 2048,
      system: `You are the ${member.title} on a review panel for a web app plan. You care about ${member.focus}
Review the Blueprint and list what's still missing or unclear before developers can build it.
Don't repeat questions already answered. Ignore anything a sensible default can cover; put those in your summary instead.
"severity": "blocking" = can't build correctly without it, "important" = affects the design, "nice" = polish.
"scores": rate how ready each area is, 1 (unknown) to 5 (clear enough to build): ${AREAS.join(", ")}.
"summary": your main point in one sentence.
Return {"summary": "...", "concerns": [{"area": "payments", "question": "...", "why": "...", "severity": "blocking"}], "scores": {"users": 3, ...}}`,
      messages: [{ role: "user", content: JSON.stringify({ blueprint, alreadyAsked: history.asked, defaultsChosen: history.defaults }) }],
    });
    const scores = Object.fromEntries(
      Object.entries(result.scores)
        .filter(([k, v]) => (AREAS as readonly string[]).includes(k) && Number.isFinite(v))
        .map(([k, v]) => [k, Math.min(5, Math.max(1, v))]),
    );
    return { role: member.role, model, summary: result.summary, concerns: result.concerns.slice(0, 6), scores };
  } catch (err) {
    return { role: member.role, model, summary: "", concerns: [], scores: {}, error: String(err instanceof Error ? err.message : err) };
  }
}

// Every member runs in the backup panel slot; the slot spreads the calls across its parts
export function memberModel(_index: number) {
  return "panel";
}
