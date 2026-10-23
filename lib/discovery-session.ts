// Discovery sessions live in memory for the hackathon (lost on server restart).
// Flow: profile questions → idea → parliament round → user answers → next round … → done.
import { randomUUID } from "node:crypto";
import { PROFILE_QUESTIONS, applyAnswers, draftBlueprint, makeProfile } from "./agents/discovery";
import { runRound } from "./parliament";
import { emptyBlueprint, type Blueprint, type Minutes, type ParliamentRound, type Profile } from "./types";

export type Phase = "profile" | "idea" | "questions" | "done";

export type Session = {
  id: string;
  phase: Phase;
  profile?: Profile;
  idea?: string;
  blueprint: Blueprint;
  rounds: ParliamentRound[];
  asked: { area: string; question: string; answer: string }[];
  minutes: Minutes;
  busy: boolean;
};

const g = globalThis as unknown as { __visionSessions?: Map<string, Session> };
const sessions = (g.__visionSessions ??= new Map());

export function getSession(id: string) {
  return sessions.get(id);
}

export function createSession(): Session {
  const s: Session = {
    id: randomUUID().slice(0, 8),
    phase: "profile",
    blueprint: emptyBlueprint(),
    rounds: [],
    asked: [],
    minutes: { decisions: [], defaults: [], disagreements: [] },
    busy: false,
  };
  sessions.set(s.id, s);
  return s;
}

export function view(s: Session) {
  const last = s.rounds.at(-1);
  return {
    id: s.id,
    phase: s.phase,
    busy: s.busy,
    profileQuestions: s.phase === "profile" ? PROFILE_QUESTIONS : undefined,
    profile: s.profile,
    blueprint: s.blueprint,
    round: last?.round ?? 0,
    questions: s.phase === "questions" ? last?.questions ?? [] : [],
    reviews: last?.reviews ?? [],
    confidence: last?.confidence ?? 0,
    areaConfidence: last?.areaConfidence,
    history: s.rounds.map((r) => ({ round: r.round, confidence: r.confidence })),
    minutes: s.minutes,
  };
}

async function parliament(s: Session) {
  const round = s.rounds.length + 1;
  const result = await runRound({
    round,
    blueprint: s.blueprint,
    level: s.profile?.level ?? "beginner",
    asked: s.asked,
    defaults: s.minutes.defaults,
  });
  s.rounds.push(result);
  s.minutes.defaults.push(...result.newDefaults);
  s.minutes.disagreements.push(...result.disagreements);
  if (result.done) {
    // Fold the final defaults into the Blueprint so the build agents see them
    if (result.newDefaults.length) {
      const merged = await applyAnswers(s.blueprint, [], result.newDefaults);
      s.blueprint = merged.blueprint;
    }
    s.blueprint.assumptions = [...new Set([...s.blueprint.assumptions, ...s.minutes.defaults])];
    s.phase = "done";
  } else {
    s.phase = "questions";
  }
}

// Runs one step; `busy` stops double submits while models are working
async function step(s: Session, fn: () => Promise<void>) {
  if (s.busy) throw new Error("Still working on the last step");
  s.busy = true;
  try {
    await fn();
  } finally {
    s.busy = false;
  }
}

export async function submitProfile(s: Session, answers: Record<string, string>) {
  s.profile = makeProfile(answers);
  s.phase = "idea";
}

export async function submitIdea(s: Session, idea: string) {
  await step(s, async () => {
    s.idea = idea;
    s.blueprint = await draftBlueprint(idea, s.profile ?? makeProfile({}));
    await parliament(s);
  });
}

export async function submitAnswers(s: Session, answers: Record<string, string>) {
  await step(s, async () => {
    const questions = s.rounds.at(-1)?.questions ?? [];
    const given = questions
      .filter((q) => answers[q.id]?.trim())
      .map((q) => ({ area: q.area, question: q.text, answer: answers[q.id].trim() }));
    s.asked.push(...given);
    const merged = await applyAnswers(s.blueprint, given, s.rounds.at(-1)?.defaults ?? []);
    s.blueprint = merged.blueprint;
    s.minutes.decisions.push(...merged.decisions);
    await parliament(s);
  });
}

// The user can stop early; remaining open questions become defaults
export function finishNow(s: Session) {
  s.phase = "done";
}
