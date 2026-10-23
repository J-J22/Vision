// One parliament round: members review in parallel → chair picks questions → translator words them → confidence.
import { config } from "../config";
import type { Blueprint, Level, ParliamentRound } from "../types";
import { MEMBERS, memberModel, review } from "./members";
import { chair, translate } from "./chair";
import { confidence } from "./confidence";

export { MEMBERS } from "./members";

export type RoundInput = {
  round: number;
  blueprint: Blueprint;
  level: Level;
  asked: { area: string; question: string; answer: string }[];
  defaults: string[];
};

export type RoundOutput = ParliamentRound & { newDefaults: string[]; disagreements: string[] };

export async function runRound(input: RoundInput): Promise<RoundOutput> {
  const { round, blueprint, level, asked, defaults } = input;
  const history = { asked: asked.map(({ question, answer }) => ({ question, answer })), defaults };

  const reviews = await Promise.all(MEMBERS.map((m, i) => review(m, memberModel(i), blueprint, history)));
  const working = reviews.filter((r) => !r.error);
  if (!working.length) throw new Error(`Every parliament member failed. First error: ${reviews[0]?.error}`);

  const decision = await chair(reviews, history.asked, config.parliament.maxQuestionsPerRound);
  const answeredAreas = new Set(asked.map((a) => a.area));
  const score = confidence(blueprint, answeredAreas, working);
  const blocking = decision.questions.filter((q) => q.blocking).length;

  const lastRound = round >= config.parliament.maxRounds;
  const done = lastRound || decision.questions.length === 0 || (score.overall >= config.parliament.confidenceThreshold && blocking === 0);

  const questions = done ? [] : await translate(decision.questions, level, blueprint.app.summary, round);

  return {
    round,
    reviews,
    questions,
    defaults: decision.defaults,
    newDefaults: done ? [...decision.defaults, ...decision.questions.map((q) => `${q.question} (decided by default)`)] : decision.defaults,
    disagreements: decision.disagreements,
    confidence: score.overall,
    areaConfidence: score.areaConfidence,
    done,
  };
}
