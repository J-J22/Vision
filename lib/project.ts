// A Vision project moves through fixed stages and never skips one:
//   discovery (interview, one question at a time)
//   → council (crossexam debate, watched live)
//   → discovery again (the council's questions, one at a time)  ↻ until confident or 3 rounds
//   → master (the master prompt, which the user approves)
//   → build
// Long steps run in the background; every change is pushed to open pages through listeners (SSE).
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { applyAnswers, draftBlueprint } from "./agents/discovery";
import { describeIdea, nextIntakeTurn, OPENING, type Facts, FactsSchema } from "./agents/intake";
import { writeMasterPrompt } from "./agents/master";
import { runCouncil } from "./council";
import { startBuild } from "./runner";
import { emptyBlueprint, type Blueprint, type ChatMessage, type CouncilRound, type Minutes, type Stage, type UserQuestion } from "./types";

export type Project = {
  id: string;
  stage: Stage;
  createdAt: string;
  chat: ChatMessage[];
  facts: Facts;
  intakeDone: boolean;
  blueprint: Blueprint;
  rounds: CouncilRound[];
  // The council's questions for the user, asked one at a time
  queue: UserQuestion[];
  queueIndex: number;
  asked: { area: string; question: string; answer: string }[];
  minutes: Minutes;
  masterPrompt?: string;
  buildId?: string;
  busy?: string; // what Vision is doing right now, shown to the user
  error?: string;
  origin: string; // where this server is reachable, for the council's model relay
};

const DATA = join(process.cwd(), "data");

const g = globalThis as unknown as {
  __visionProjects?: Map<string, Project>;
  __visionListeners?: Map<string, Set<() => void>>;
  __visionRelayToken?: string;
};
const projects = (g.__visionProjects ??= new Map());
const listeners = (g.__visionListeners ??= new Map());

// Only crossexam (started by this server) may use the council relay
export const relayToken = (g.__visionRelayToken ??= randomBytes(24).toString("hex"));

const now = () => new Date().toISOString();
const msgId = () => randomUUID().slice(0, 8);

// ---------- storage + live updates ----------

function save(p: Project) {
  mkdirSync(join(DATA, "projects"), { recursive: true });
  writeFileSync(join(DATA, "projects", `${p.id}.json`), JSON.stringify(p, null, 1));
}

function changed(p: Project) {
  save(p);
  for (const fn of listeners.get(p.id) ?? []) fn();
}

export function subscribe(id: string, fn: () => void) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  return () => listeners.get(id)?.delete(fn);
}

export function getProject(id: string): Project | undefined {
  if (!/^[a-z0-9]{8}$/.test(id)) return undefined;
  if (projects.has(id)) return projects.get(id);
  const file = join(DATA, "projects", `${id}.json`);
  if (!existsSync(file)) return undefined;
  const p = JSON.parse(readFileSync(file, "utf8")) as Project;
  // A step that was running when the server stopped won't finish; let the user retry
  if (p.busy) {
    p.error = `Vision restarted while "${p.busy}" was running. Use Retry.`;
    p.busy = undefined;
  }
  projects.set(id, p);
  return p;
}

export function view(p: Project) {
  return { ...p, current: p.queue[p.queueIndex], questionNumber: p.queueIndex + 1, questionTotal: p.queue.length };
}

// Runs a slow step in the background; the page sees `busy` until it's done
function background(p: Project, label: string, fn: () => Promise<void>) {
  p.busy = label;
  p.error = undefined;
  changed(p);
  fn()
    .catch((err) => {
      console.error(`[project ${p.id}] ${label}`, err);
      p.error = String(err instanceof Error ? err.message : err).slice(0, 600);
    })
    .finally(() => {
      p.busy = undefined;
      changed(p);
    });
}

function say(p: Project, msg: Omit<ChatMessage, "id" | "at">) {
  p.chat.push({ id: msgId(), at: now(), ...msg });
}

// ---------- create ----------

// `idea` comes from the landing page's input; when given, the interview starts from it
export function createProject(origin: string, idea = ""): Project {
  const p: Project = {
    id: randomUUID().replace(/-/g, "").slice(0, 8),
    stage: "discovery",
    createdAt: now(),
    chat: [],
    facts: FactsSchema.parse({}),
    intakeDone: false,
    blueprint: emptyBlueprint(),
    rounds: [],
    queue: [],
    queueIndex: 0,
    asked: [],
    minutes: { decisions: [], defaults: [], disagreements: [] },
    origin,
  };
  if (idea) {
    p.facts.idea = idea.slice(0, 1000);
    say(p, { from: "user", text: p.facts.idea });
    say(p, { from: "vision", text: "Got it. I'll plan this with you, and a council of AIs will check the plan before anything gets built." });
  }
  // The opening question's text must stay exactly OPENING.text: the interview recognises answers by it
  say(p, { from: "vision", text: OPENING.text, options: OPENING.options.map((label) => ({ label })) });
  projects.set(p.id, p);
  changed(p);
  return p;
}

// ---------- discovery: the interview ----------

function interviewTurn(p: Project) {
  background(p, "Thinking about your answer…", async () => {
    const turn = await nextIntakeTurn(p.chat, p.facts);
    p.facts = turn.facts;
    say(p, {
      from: "vision",
      text: turn.message,
      why: turn.why || undefined,
      options: turn.options.length ? turn.options.map((label, i) => ({ label, recommended: i === turn.recommended })) : undefined,
    });
    if (turn.done) {
      p.intakeDone = true;
      await draftAndConvene(p);
    }
  });
}

async function draftAndConvene(p: Project) {
  p.busy = "Writing the first draft of your plan…";
  changed(p);
  const f = p.facts;
  const draft = await draftBlueprint(describeIdea(f), { role: f.role, codes: f.codes, builtBefore: f.builtBefore, goal: f.audience, level: f.level });
  draft.design = { feel: f.designFeel, colors: f.designColors, references: f.designReferences, devices: f.devices };
  p.blueprint = draft;
  say(p, { from: "vision", text: `Your first draft is ready: "${draft.app.name || "your app"}". The review council is examining it now.` });
  p.stage = "council";
  changed(p);
  await councilRound(p);
}

// ---------- council ----------

// Runs one council round to the end, then either hands its questions to the chat or finishes
async function councilRound(p: Project) {
  const round = p.rounds.length + 1;
  p.rounds.push({ round, status: "running", phase: "blind", sealed: [], messages: [], consensus: [], disagreements: [], questions: [], defaults: [], agreement: 0, confidence: 0, engine: "crossexam" });
  p.busy = `Council round ${round} is in session…`;
  changed(p);
  const result = await runCouncil({
    dir: join(DATA, "councils", p.id, `round-${round}`),
    round,
    blueprint: p.blueprint,
    level: p.facts.level,
    asked: p.asked,
    defaults: p.minutes.defaults,
    relayUrl: `${p.origin}/api/council-llm/v1`,
    relayToken,
    onUpdate: (r) => {
      p.rounds[round - 1] = r;
      changed(p);
    },
  });
  p.rounds[round - 1] = result;
  if (result.status === "failed") throw new Error(result.error ?? "The council couldn't finish this round");
  p.minutes.disagreements.push(...result.disagreements);

  const blocking = result.questions.some((q) => q.blocking);
  const confident = result.confidence >= config.parliament.confidenceThreshold && !blocking;
  if (!result.questions.length || (confident && round > 1)) {
    await finishCouncil(p);
    return;
  }
  // Hand the questions to the chat, one at a time
  p.queue = result.questions;
  p.queueIndex = 0;
  p.stage = "discovery";
  say(p, { from: "vision", text: `The council has ${result.questions.length} question${result.questions.length === 1 ? "" : "s"} for you. One at a time:` });
  askCurrent(p);
}

function askCurrent(p: Project) {
  const q = p.queue[p.queueIndex];
  if (!q) return;
  say(p, {
    from: (q.askedBy as ChatMessage["from"]) || "vision",
    text: q.text,
    why: q.why,
    options: q.options,
    questionId: q.id,
  });
}

function answerCouncilQuestion(p: Project, answer: string) {
  const q = p.queue[p.queueIndex];
  p.asked.push({ area: q.area, question: q.text, answer });
  p.queueIndex++;
  if (p.queueIndex < p.queue.length) {
    askCurrent(p);
    changed(p);
    return;
  }
  // All answered: fold them into the plan, then either another round or the master prompt
  const round = p.rounds.at(-1)!;
  const answers = p.asked.slice(-p.queue.length);
  p.queue = [];
  p.queueIndex = 0;
  background(p, "Updating your plan with your answers…", async () => {
    const merged = await applyAnswers(p.blueprint, answers, round.defaults);
    p.blueprint = { ...merged.blueprint, design: merged.blueprint.design.feel ? merged.blueprint.design : p.blueprint.design };
    p.minutes.decisions.push(...merged.decisions);
    p.minutes.defaults.push(...round.defaults);
    if (p.rounds.length >= config.parliament.maxRounds) {
      say(p, { from: "vision", text: "Thanks. That's everything the council needed. Writing your master prompt now." });
      await finishCouncil(p);
    } else {
      say(p, { from: "vision", text: `Thanks. The council is reviewing your answers in round ${p.rounds.length + 1}.` });
      p.stage = "council";
      await councilRound(p);
    }
  });
}

async function finishCouncil(p: Project) {
  p.busy = "Writing the master prompt…";
  p.stage = "master";
  changed(p);
  const consensus = p.rounds.flatMap((r) => r.consensus);
  p.masterPrompt = await writeMasterPrompt(p.blueprint, p.minutes, consensus, p.asked);
}

// ---------- actions from the pages ----------

export function act(p: Project, action: string, payload: Record<string, unknown> = {}) {
  if (p.busy && action !== "get") throw new Error("Vision is still working on the last step.");
  switch (action) {
    case "answer": {
      const text = String(payload.text ?? "").trim();
      if (!text) throw new Error("Type or pick an answer first.");
      if (p.stage !== "discovery") throw new Error("There's no question waiting for an answer right now.");
      say(p, { from: "user", text });
      if (p.queue.length) answerCouncilQuestion(p, text);
      else if (!p.intakeDone) interviewTurn(p);
      break;
    }
    case "skip-questions": {
      // Remaining questions become defaults
      if (!p.queue.length) throw new Error("No questions to skip.");
      const rest = p.queue.slice(p.queueIndex).map((q) => `${q.text} (decided by default)`);
      p.minutes.defaults.push(...rest);
      p.queue = [];
      p.queueIndex = 0;
      background(p, "Writing the master prompt…", () => finishCouncil(p));
      break;
    }
    case "retry": {
      // Re-run whatever step failed
      if (p.stage === "council") {
        if (p.rounds.at(-1)?.status !== "done") p.rounds.pop();
        background(p, "Restarting the council…", () => councilRound(p));
      } else if (p.stage === "master" && !p.masterPrompt) background(p, "Writing the master prompt…", () => finishCouncil(p));
      else if (p.stage === "discovery" && !p.intakeDone) interviewTurn(p);
      else if (p.stage === "discovery" && p.intakeDone && !p.rounds.length) background(p, "Writing the first draft…", () => draftAndConvene(p));
      break;
    }
    case "update-master": {
      if (p.stage !== "master") throw new Error("The master prompt can only be edited before the build starts.");
      p.masterPrompt = String(payload.text ?? "");
      break;
    }
    case "approve": {
      if (p.stage !== "master" || !p.masterPrompt) throw new Error("The master prompt isn't ready yet.");
      const build = startBuild(p.blueprint, p.minutes, p.masterPrompt);
      p.buildId = build.id;
      p.stage = "build";
      break;
    }
    default:
      throw new Error(`Unknown action ${action}`);
  }
  changed(p);
}
