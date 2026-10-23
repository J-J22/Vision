// The interviewer: gets to know the user and their idea, one question per message.
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import { LEVELS, type ChatMessage, type Level } from "../types";

export const FactsSchema = z.object({
  role: z.string().default(""),
  codes: z.string().default(""),
  builtBefore: z.string().default(""),
  level: z.enum(LEVELS).default("beginner"),
  idea: z.string().default(""),
  audience: z.string().default(""),
  mustHave: z.string().default(""),
  designFeel: z.string().default(""),
  designColors: z.string().default(""),
  designReferences: z.string().default(""),
  devices: z.string().default(""),
});
export type Facts = z.infer<typeof FactsSchema>;

// Models sometimes send options as {"label": "..."} instead of plain strings; accept both
const Option = z.union([z.string(), z.object({ label: z.string() }).transform((o) => o.label)]);

const TurnSchema = z.object({
  message: z.string(),
  options: z.array(Option).max(5).default([]),
  recommended: z.number().int().optional(),
  why: z.string().default(""),
  done: z.boolean().default(false),
  facts: FactsSchema.default({}),
});

export const MAX_INTAKE_QUESTIONS = 9;

// The first question is fixed, so the chat opens instantly
export const OPENING = {
  text: "Hi, I'm Vision. Before we plan your app, a few quick questions so I can talk to you at the right level. What best describes you?",
  options: ["Founder or business owner", "Student", "Developer", "Designer or product person", "Something else"],
};

const SYSTEM = `You are Vision's interviewer. You talk with a person who wants an app built, to learn who they are and what they want.
Rules:
- Ask exactly ONE short question per message. Never two questions in one message.
- They already answered what describes them, whether they code, and whether they've launched an app (see knownFacts).
- Cover, in this order: their app idea (an open question: no options), then 1-2 follow-ups about the idea (who it's for, the one thing it must do well),
  then design: the feel they want, brand colors or "no preference", and whether people will mostly use phones or computers.
- For every question except the open idea question, give 2-5 short answer options in "options". Put the best choice for a first version
  in "recommended" (its index), only when one choice is clearly better.
- "why": one short sentence on why you're asking, in plain words.
- knownFacts.level is their level ("beginner" doesn't code, "some-tech" a little, "developer"). Word everything for that level: no jargon for beginners.
- Never ask something they already told you. If an answer covers several topics, skip ahead.
- "facts": everything you know so far, including facts from earlier turns (repeat them every time).
- Set "done": true once you know their role, coding level, the idea, who it's for, and the design feel, or after ${MAX_INTAKE_QUESTIONS} questions,
  or if they ask to move on. When done, "message" is one short line saying you're sending their plan to the review council, with no question.
Return {"message": "...", "options": [], "recommended": 0, "why": "", "done": false, "facts": {...}}`;

export type IntakeTurn = z.infer<typeof TurnSchema>;

// If the model fails, fall back to a fixed script based on what's still unknown
function scripted(facts: Facts, asked: number): IntakeTurn {
  const steps: [keyof Facts, string, string[]][] = [
    ["role", OPENING.text, OPENING.options],
    ["codes", "Do you write code?", ["No", "A little", "Yes, regularly"]],
    ["builtBefore", "Have you launched an app or website before?", ["No", "Yes, with help", "Yes, on my own"]],
    ["idea", "What do you want to build? A sentence or two is enough.", []],
    ["audience", "Who is it for?", []],
    ["designFeel", "What feel should it have?", ["Clean and minimal", "Bold and colorful", "Warm and friendly", "Premium and dark"]],
    ["devices", "Will people mostly use it on phones or computers?", ["Mostly phones", "Mostly computers", "Both equally"]],
  ];
  const next = steps.find(([key]) => !facts[key]);
  if (!next || asked >= MAX_INTAKE_QUESTIONS) {
    return { message: "Thanks, that's what I need. I'm sending your plan to the review council now.", options: [], why: "", done: true, facts };
  }
  return { message: next[1], options: next[2], why: "", done: false, facts };
}

// The three "about you" questions are fixed: instant, and nothing for a model to get wrong
const PROFILE_STEPS: { key: "role" | "codes" | "builtBefore"; text: string; options: string[] }[] = [
  { key: "role", text: OPENING.text, options: OPENING.options },
  { key: "codes", text: "Do you write code?", options: ["No", "A little", "Yes, regularly"] },
  { key: "builtBefore", text: "Have you launched an app or website before?", options: ["No", "Yes, with help", "Yes, on my own"] },
];
const CODES_TO_LEVEL: Record<string, Facts["level"]> = { No: "beginner", "A little": "some-tech", "Yes, regularly": "developer" };

// Records the answer to the last fixed question, then returns the next fixed question (or none left)
function profileStep(chat: ChatMessage[], facts: Facts): { facts: Facts; turn: IntakeTurn | null } {
  const lastQuestion = [...chat].reverse().find((m) => m.from === "vision");
  const answered = PROFILE_STEPS.find((s) => s.text === lastQuestion?.text);
  const reply = chat.at(-1)?.from === "user" ? chat.at(-1)!.text : "";
  const next = { ...facts };
  if (answered && reply) {
    next[answered.key] = reply;
    if (answered.key === "codes") next.level = CODES_TO_LEVEL[reply] ?? (/regular|yes/i.test(reply) ? "developer" : /little|bit/i.test(reply) ? "some-tech" : "beginner");
  }
  const step = PROFILE_STEPS.find((s) => !next[s.key]);
  return { facts: next, turn: step ? { message: step.text, options: step.options, why: "", done: false, facts: next } : null };
}

const asWords = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, "").trim();

export async function nextIntakeTurn(chat: ChatMessage[], known: Facts): Promise<IntakeTurn> {
  const asked = chat.filter((m) => m.from === "vision").length;
  const profile = profileStep(chat, known);
  if (profile.turn) return profile.turn;
  const facts = profile.facts;
  // From here a model leads the interview
  const previous = new Set(chat.filter((m) => m.from === "vision").map((m) => asWords(m.text)));
  try {
    const turn = await callLLM({
      label: "intake",
      // Alternate models so the interview doesn't wait on one model's per-minute limit
      model: asked % 2 ? config.models.small : config.models.parliament[1],
      schema: TurnSchema,
      temperature: 0.4,
      maxTokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            questionsAskedSoFar: asked,
            conversation: chat.slice(-16).map((m) => ({ from: m.from === "user" ? "user" : "vision", text: m.text })),
            knownFacts: facts,
          }),
        },
      ],
    });
    // Keep earlier facts the model forgot to repeat; the fixed profile answers always win
    const merged = { ...facts, ...Object.fromEntries(Object.entries(turn.facts).filter(([, v]) => v)), role: facts.role, codes: facts.codes, builtBefore: facts.builtBefore, level: facts.level } as Facts;
    // Never ask the same question twice, and stop at the question limit
    if ((!turn.done && previous.has(asWords(turn.message))) || (asked >= MAX_INTAKE_QUESTIONS && !turn.done)) return scripted(merged, asked);
    return { ...turn, facts: merged };
  } catch (err) {
    console.warn(`[intake] model failed, using the scripted question: ${err}`);
    return scripted(facts, asked);
  }
}

export function levelFromFacts(facts: Facts): Level {
  return facts.level;
}

// One paragraph the draft writer can work from
export function describeIdea(facts: Facts): string {
  return [
    `Idea: ${facts.idea}`,
    facts.audience && `For: ${facts.audience}`,
    facts.mustHave && `Must do well: ${facts.mustHave}`,
    facts.designFeel && `Design feel: ${facts.designFeel}`,
    facts.designColors && `Colors/brand: ${facts.designColors}`,
    facts.designReferences && `Design references: ${facts.designReferences}`,
    facts.devices && `Devices: ${facts.devices}`,
  ]
    .filter(Boolean)
    .join("\n");
}
