// The review council: five AI seats examine the plan with crossexam (vendor/crossexam).
// 1. blind: each seat writes its own findings, sealed so nobody copies anybody
// 2. debate: envelopes open; seats verify, challenge or concede each other's claims
// 3. synthesis: the architect seat writes the consensus + disagreement table
// Vision watches crossexam's files as it runs and streams every message to the council page,
// then turns the outcome into simple questions for the user.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { callLLM } from "./llm";
import { config } from "./config";
import { translate } from "./parliament/chair";
import { coverage } from "./parliament/confidence";
import { runRound } from "./parliament";
import { AREAS, type Blueprint, type CouncilMessage, type CouncilRound, type CouncilSeat, type Level } from "./types";

const CROSSEXAM = join(process.cwd(), "vendor", "crossexam", "crossexam.py");

// Each seat is an AI slot (lib/slots.ts); crossexam passes the slot id to Vision's relay as the "model"
export const SEATS: { seat: CouncilSeat; title: string; focus: string; slot: string }[] = [
  { seat: "architect", title: "Architect", focus: "data model, API endpoints, how pages get their data, scale and hosting", slot: "seat-architect" },
  { seat: "product", title: "Product lead", focus: "who the users are, what each role can do, which features belong in the first version, key user journeys", slot: "seat-product" },
  { seat: "security", title: "Security & payments", focus: "login, who may do what, how money moves, fraud and abuse, privacy", slot: "seat-security" },
  { seat: "skeptic", title: "Skeptic", focus: "contradictions, unrealistic scope, edge cases (sold out, cancellations, disputes, empty states) the others miss", slot: "seat-skeptic" },
  { seat: "designer", title: "Designer", focus: "key screens, how users move between them, mobile vs desktop, the visual feel and brand", slot: "seat-designer" },
];

// ---------- Python ----------

let pythonCmd: string | null | undefined;
function python(): string | null {
  if (pythonCmd !== undefined) return pythonCmd;
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  pythonCmd = candidates.find((cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0) ?? null;
  return pythonCmd;
}

// ---------- the task every seat receives ----------

function summarizeBlueprint(bp: Blueprint): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (not decided yet)");
  return [
    `App: ${bp.app.name || "(unnamed)"} (${bp.app.type}): ${bp.app.summary}`,
    `For: ${bp.user.goal || "?"}; made by a ${bp.user.role || "person"} (${bp.user.level})`,
    `Roles:\n${list(bp.roles.map((r) => `${r.name}: ${r.can.join(", ")}`))}`,
    `Features:\n${list(bp.features.map((f) => `${f.name}${f.mvp ? "" : " (later)"}: ${f.stories.join(" ")}`))}`,
    `Pages:\n${list(bp.pages.map((p) => `${p.path}: ${p.purpose}`))}`,
    `Data:\n${list(bp.entities.map((e) => `${e.name}(${e.fields.map((f) => f.name).join(", ")})`))}`,
    `Login: ${bp.auth.method || "?"} | Payments: ${bp.payments.mode || "?"} | Users: ${bp.nonFunctional.users || "?"}`,
    `Design: feel ${bp.design.feel || "?"}; colors ${bp.design.colors || "?"}; devices ${bp.design.devices || "?"}`,
    bp.assumptions.length ? `Assumptions so far:\n${list(bp.assumptions)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildTask(bp: Blueprint, asked: { question: string; answer: string }[], defaults: string[], round: number) {
  return `Review this app plan before AI developers build it (review round ${round}).
Your job: find what is still MISSING or UNCLEAR that would make the developers build the wrong thing.

Each seat reviews from its own angle:
${SEATS.map((s) => `- ${s.seat}: ${s.focus}`).join("\n")}

Keep it short: "analysis" at most 120 words, listing your top 2-3 gaps, each as a question to ask the app's owner and why it matters.
"msg" is one line with your single most important point. Don't repeat questions already answered below.

# THE PLAN
${summarizeBlueprint(bp)}

# ALREADY ANSWERED BY THE OWNER
${asked.length ? asked.map((a) => `- Q: ${a.question} A: ${a.answer}`).join("\n") : "- (nothing yet)"}

# DEFAULTS ALREADY CHOSEN
${defaults.length ? defaults.slice(-15).map((d) => `- ${d}`).join("\n") : "- (none)"}`;
}

// ---------- reading crossexam's files while it runs ----------

function readBus(msgDir: string): CouncilMessage[] {
  const bus = join(msgDir, "bus.jsonl");
  if (!existsSync(bus)) return [];
  const lines = readFileSync(bus, "utf8").split("\n").filter(Boolean);
  const out: CouncilMessage[] = [];
  lines.forEach((line, i) => {
    try {
      const m = JSON.parse(line);
      out.push({ n: i + 1, from: m.from, type: m.type, msg: m.msg, at: m.ts });
    } catch {}
  });
  return out;
}

// Latest analysis section a seat wrote (crossexam appends one "## <time> (...)" section per turn)
function latestAnalysis(msgDir: string, seat: string): string {
  const file = join(msgDir, "analysis", `${seat}.md`);
  if (!existsSync(file)) return "";
  const parts = readFileSync(file, "utf8").split(/\n## [^\n]*\n/);
  return (parts.at(-1) ?? "").trim().slice(0, 2000);
}

function sealedSeats(msgDir: string): CouncilSeat[] {
  const dir = join(msgDir, ".sealed");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => f.replace(/\.jsonl$/, "") as CouncilSeat);
}

// ---------- turning the debate into questions ----------

const ConclusionSchema = z.object({
  consensus: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
  questions: z
    .array(z.object({ area: z.string().default("features"), question: z.string(), why: z.string().default(""), blocking: z.boolean().default(false), askedBy: z.string().default("") }))
    .default([]),
  defaults: z.array(z.string()).default([]),
});

async function conclude(synthesis: string, messages: CouncilMessage[], asked: { question: string; answer: string }[]) {
  return callLLM({
    label: "council conclusion",
    slot: "head",
    schema: ConclusionSchema,
    maxTokens: 2000,
    system: `You turn a review council's debate about an app plan into next steps.
- "consensus": what the council agreed the app must do, as short requirement sentences (max 8).
- "disagreements": unresolved points, one line each (max 5).
- "questions": at most ${config.parliament.maxQuestionsPerRound} questions for the app's owner, most important first. Only things that change what gets built.
  Merge duplicates and drop anything already answered. "blocking": true only if building without the answer would likely be wrong.
  "area" is one of ${AREAS.join(", ")}. "askedBy" is the seat that raised it.
- "defaults": every other open point, decided sensibly, as plain sentences ("Each project can show up to 6 images").
Return {"consensus": [], "disagreements": [], "questions": [{"area": "", "question": "", "why": "", "blocking": false, "askedBy": "architect"}], "defaults": []}`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          synthesis: synthesis.slice(0, 6000),
          debate: messages.filter((m) => m.from !== "moderator").map((m) => `${m.from} (${m.type}): ${m.msg}`).slice(-30),
          alreadyAnswered: asked,
        }),
      },
    ],
  });
}

function agreementOf(messages: CouncilMessage[]) {
  const agree = messages.filter((m) => m.type === "verify" || m.type === "concede").length;
  const disagree = messages.filter((m) => m.type === "challenge").length;
  return agree + disagree === 0 ? 0.6 : Math.round((agree / (agree + disagree)) * 100) / 100;
}

// Plan confidence: how much of the plan is covered + how much the council agreed + whether anything blocks
function scoreRound(bp: Blueprint, answeredAreas: Set<string>, agreement: number, blocking: number) {
  const cov = coverage(bp, answeredAreas);
  const value = { missing: 0, defaulted: 0.75, answered: 1 } as const;
  const areaConfidence = Object.fromEntries(AREAS.map((a) => [a, value[cov[a]]])) as Record<(typeof AREAS)[number], number>;
  const coverageScore = AREAS.reduce((sum, a) => sum + areaConfidence[a], 0) / AREAS.length;
  const confidence = 0.55 * coverageScore + 0.3 * agreement + 0.15 * (blocking === 0 ? 1 : Math.max(0, 1 - blocking / 3));
  return { confidence: Math.round(confidence * 100) / 100, areaConfidence };
}

// ---------- running one round ----------

export type CouncilInput = {
  dir: string; // where crossexam keeps this round's files
  round: number;
  blueprint: Blueprint;
  level: Level;
  asked: { area: string; question: string; answer: string }[];
  defaults: string[];
  relayUrl: string; // Vision's /api/council-llm/v1
  relayToken: string;
  onUpdate: (r: CouncilRound) => void;
};

function emptyRound(round: number, engine: CouncilRound["engine"]): CouncilRound {
  return { round, status: "running", phase: "blind", sealed: [], messages: [], consensus: [], disagreements: [], questions: [], defaults: [], agreement: 0, confidence: 0, engine };
}

async function runCrossexam(input: CouncilInput, state: CouncilRound): Promise<{ synthesis: string; ok: boolean; log: string }> {
  const py = python();
  if (!py) return { synthesis: "", ok: false, log: "Python 3 not found" };
  rmSync(input.dir, { recursive: true, force: true });
  mkdirSync(input.dir, { recursive: true });
  const msgDir = join(input.dir, "_Msg");

  const args = [
    CROSSEXAM,
    "run",
    "--task",
    buildTask(input.blueprint, input.asked, input.defaults, input.round),
    ...SEATS.flatMap((s) => ["--api", `${s.seat}=${input.relayUrl}|${s.slot}`]),
    "--synthesis",
    "architect",
    "--rounds",
    "1",
    "--seat-timeout",
    "300",
  ];

  return new Promise((resolve) => {
    const proc = spawn(py, args, {
      cwd: input.dir,
      env: { ...process.env, CX_API_KEY: input.relayToken, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    let lastSeen = "";

    const refresh = () => {
      const messages = readBus(msgDir);
      // Attach each seat's longer reasoning to its latest message
      for (const m of messages) {
        if (m.from !== "moderator" && !m.analysis) m.analysis = latestAnalysis(msgDir, m.from);
      }
      const next = { ...state, messages, sealed: sealedSeats(msgDir) };
      const key = JSON.stringify([next.messages.length, next.sealed, next.speaking, next.phase]);
      Object.assign(state, next);
      if (key !== lastSeen) {
        lastSeen = key;
        input.onUpdate({ ...state });
      }
    };
    const timer = setInterval(refresh, 700);

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      log += text;
      for (const line of text.split("\n")) {
        const turn = line.match(/^\s+\[(blind|debate)\]\s+(\w+)/);
        if (turn) {
          state.phase = turn[1] as "blind" | "debate";
          state.speaking = turn[2] as CouncilSeat;
        } else if (line.startsWith("== synthesis")) {
          state.phase = "synthesis";
          state.speaking = "architect";
        }
      }
      refresh();
    });
    proc.stderr.on("data", (chunk: Buffer) => (log += chunk.toString()));
    proc.on("exit", (code) => {
      clearInterval(timer);
      state.speaking = undefined;
      refresh();
      const synthesisFile = join(msgDir, "synthesis.md");
      const synthesis = existsSync(synthesisFile) ? readFileSync(synthesisFile, "utf8") : "";
      const claims = state.messages.filter((m) => m.type === "claim").length;
      resolve({ synthesis, ok: code === 0 && claims > 0, log });
    });
  });
}

// If crossexam can't run (no Python, or every seat failed), the built-in panel reviews the plan instead
async function runFallback(input: CouncilInput, state: CouncilRound) {
  state.engine = "fallback";
  input.onUpdate({ ...state });
  const result = await runRound({ round: input.round, blueprint: input.blueprint, level: input.level, asked: input.asked, defaults: input.defaults });
  const now = new Date().toISOString();
  state.messages = result.reviews
    .filter((r) => !r.error)
    .map((r, i) => ({ n: i + 1, from: r.role as CouncilSeat, type: "claim" as const, msg: r.summary, analysis: r.concerns.map((c) => `- ${c.question} (${c.why})`).join("\n"), at: now }));
  return { questions: result.questions, defaults: result.newDefaults, disagreements: result.disagreements };
}

export async function runCouncil(input: CouncilInput): Promise<CouncilRound> {
  const state = emptyRound(input.round, "crossexam");
  input.onUpdate({ ...state });
  const answeredAreas = new Set(input.asked.map((a) => a.area));

  try {
    const run = await runCrossexam(input, state);
    if (!run.ok) throw new Error(`crossexam didn't finish: ${run.log.slice(-800)}`);

    state.phase = "closed";
    state.synthesis = run.synthesis;
    input.onUpdate({ ...state });

    const outcome = await conclude(run.synthesis, state.messages, input.asked);
    const blocking = outcome.questions.filter((q) => q.blocking).length;
    state.agreement = agreementOf(state.messages);
    Object.assign(state, scoreRound(input.blueprint, answeredAreas, state.agreement, blocking));
    state.consensus = outcome.consensus;
    state.disagreements = outcome.disagreements;
    state.defaults = outcome.defaults;
    const worded = await translate(outcome.questions, input.level, input.blueprint.app.summary, input.round);
    state.questions = worded.map((q, i) => ({ ...q, askedBy: outcome.questions[i]?.askedBy, blocking: outcome.questions[i]?.blocking }));
  } catch (err) {
    console.warn(`[council] ${err instanceof Error ? err.message : err}; using the built-in panel`);
    state.error = String(err instanceof Error ? err.message : err).slice(0, 500);
    try {
      const fb = await runFallback(input, state);
      state.questions = fb.questions;
      state.defaults = fb.defaults;
      state.disagreements = fb.disagreements;
      state.agreement = 0.6;
      Object.assign(state, scoreRound(input.blueprint, answeredAreas, state.agreement, 0));
    } catch (err2) {
      state.status = "failed";
      state.error = `${state.error} | fallback failed too: ${err2 instanceof Error ? err2.message : err2}`;
      input.onUpdate({ ...state });
      return state;
    }
  }

  state.phase = "closed";
  state.status = "done";
  state.speaking = undefined;
  input.onUpdate({ ...state });
  return state;
}
