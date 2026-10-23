// The backend and frontend agents. Each task asks one agent to write a few files.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import { conventions, readWorkspace } from "../sandbox";
import type { AgentOutput, Blueprint, Minutes, Task } from "../types";
import { contractText, type Endpoint } from "./planner";
import { testsText, type EdgeTest } from "./qa";

const OutputSchema = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  note: z.string().default(""),
});

export type AgentInput = {
  buildId: string;
  task: Task;
  blueprint: Blueprint;
  minutes?: Minutes;
  notes: { agent: string; text: string }[]; // what teammates said so far
  api: Endpoint[]; // the contract every agent builds to
  tests: EdgeTest[]; // QA's edge-case tests, written before the code
  fix?: string; // set for fix tasks: what went wrong and what to change
};

// Kept small: Groq's free tier allows 8,000 tokens per minute per model, prompt and answer together
const MAX_FILE_CHARS = 5000;
const MAX_CONTEXT_CHARS = 7000;

function filesBlock(files: Record<string, string>): string {
  let total = 0;
  const parts: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + "\n/* ...truncated... */" : content;
    if (total + body.length > MAX_CONTEXT_CHARS) {
      parts.push(`--- ${path} (not shown, context full)`);
      continue;
    }
    total += body.length;
    parts.push(`--- ${path}\n${body}`);
  }
  return parts.join("\n\n") || "(none yet)";
}

// The API as other agents built it: every app.get/post/... line in routes/
function apiSummary(files: Record<string, string>): string {
  const lines: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith("routes/")) continue;
    for (const m of content.matchAll(/app\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]/g)) {
      lines.push(`${m[1].toUpperCase()} ${m[2]}  (${path})`);
    }
  }
  return lines.join("\n") || "(no endpoints yet)";
}

const TEAM = `You are on an AI developer team building a web app together. Teammates: a project manager, a backend developer,
a frontend developer and a QA tester. Work only on your task and only write the files it lists.
After the code, leave one short note for your teammates (e.g. "backend: /api/listings is ready; search uses ?q=").`;

const BACKEND_SYSTEM = `${TEAM}
You are the BACKEND developer. You write SQLite tables (db/*.sql) and Express routes (routes/*.js).
Follow these project rules exactly:

{{CONVENTIONS}}

Fields the API contract lists without "?" are required; every other field is optional: store it with a default and
never reject a request without it. The contract wins over anything else you read, because the tests follow it.
Write complete files, never placeholders or "...". Return {"files": [{"path": "...", "content": "..."}], "note": "..."}.`;

const FRONTEND_SYSTEM = `${TEAM}
You are the FRONTEND developer. You write pages in public/ as plain HTML with an inline <script>; no frameworks, no build step.
Only call API endpoints in the API contract. Make it look designed, not like a template: follow the Blueprint's design
(feel, colors, references), real copy written for this app (no lorem ipsum), a clear hero on the home page, friendly empty
states, and layouts that work on a 360px phone. For the theme task, write theme.css as a complete visual identity
(palette, fonts, buttons, cards, nav, spacing) built on the base classes. Follow these project rules exactly:

{{CONVENTIONS}}

Write complete files, never placeholders or "...". Return {"files": [{"path": "...", "content": "..."}], "note": "..."}.`;

// Each agent sees only the parts of the Blueprint its job needs
function blueprintSlice(bp: Blueprint, agent: string) {
  const features = bp.features.filter((f) => f.mvp).map((f) => ({ name: f.name, stories: f.stories }));
  return agent === "backend"
    ? { app: bp.app.name, features, entities: bp.entities, endpoints: bp.endpoints, payments: bp.payments.mode }
    : { app: bp.app, roles: bp.roles, features, pages: bp.pages, design: bp.design };
}

function taskMessage(input: AgentInput, extra: Record<string, string>) {
  const { task, notes, fix, minutes } = input;
  return [
    `TASK ${task.id}: ${task.title}`,
    `Files you must write: ${task.files.join(", ")}`,
    fix ? `\nTHIS IS A FIX. The tests found problems:\n${fix}\nRewrite the files so these problems are fixed, keeping everything else working.` : "",
    `\nBLUEPRINT:\n${JSON.stringify(blueprintSlice(input.blueprint, task.agent))}`,
    minutes?.decisions.length ? `\nDECISIONS MADE WITH THE USER:\n- ${minutes.decisions.join("\n- ")}` : "",
    ...Object.entries(extra).map(([k, v]) => `\n${k}:\n${v}`),
    `\nNOTES FROM TEAMMATES:\n${notes.slice(-12).map((n) => `${n.agent}: ${n.text}`).join("\n") || "(none)"}`,
  ].join("\n");
}

// ---------- fake mode (VISION_FAKE_AGENTS=1): no Groq calls ----------

const REFERENCE = join(process.cwd(), "tests", "reference");

async function fakeAgent(input: AgentInput): Promise<AgentOutput> {
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
  // Backend tasks use the hand-written reference files when they exist, so the app really works
  const files = input.task.files
    .filter((f) => existsSync(join(REFERENCE, f)))
    .map((f) => ({ path: f, content: readFileSync(join(REFERENCE, f), "utf8") }));
  return { files, note: `${input.task.agent}: (fake) finished "${input.task.title}"` };
}

// ---------- real agents ----------

export async function runCoder(input: AgentInput): Promise<AgentOutput> {
  if (config.fakeAgents) return fakeAgent(input);

  const workspace = readWorkspace(input.buildId);
  // Show the agent its own files (for fixes) and what teammates wrote that it depends on
  const mine = Object.fromEntries(Object.entries(workspace).filter(([p]) => input.task.files.includes(p)));
  const isBackend = input.task.agent === "backend";

  const system = (isBackend ? BACKEND_SYSTEM : FRONTEND_SYSTEM).replace("{{CONVENTIONS}}", () => conventions(isBackend ? "backend" : "frontend"));

  const contract = contractText(input.api) || "(no API: this app is pages only)";
  const extra: Record<string, string> = isBackend
    ? {
        "API CONTRACT (build exactly this)": contract,
        "EDGE-CASE TESTS QA WILL RUN (make them pass)": testsText(input.tests) || "(only the smoke tests)",
        "EXISTING TABLES": filesBlock(Object.fromEntries(Object.entries(workspace).filter(([p]) => p.startsWith("db/")))),
        // Other route files as an endpoint list only: full code would blow the token budget
        "ENDPOINTS OTHER TASKS BUILT": apiSummary(Object.fromEntries(Object.entries(workspace).filter(([p]) => !input.task.files.includes(p)))),
      }
    : {
        "API CONTRACT (the endpoints you may call)": contract,
        "API LIST (what the backend built)": apiSummary(workspace),
        "EXISTING PAGES": Object.keys(workspace).filter((p) => p.endsWith(".html")).join(", "),
      };
  if (Object.keys(mine).length) extra["YOUR CURRENT FILES"] = filesBlock(mine);

  const result = await callLLM({
    label: `${input.task.agent} ${input.task.id}`,
    // The theme decides how every page looks, so it gets its own position (a stronger model by default)
    slot: isBackend ? "backend" : input.task.files.includes("public/theme.css") ? "theme" : "frontend",
    system,
    schema: OutputSchema,
    // Pages and a full theme run long; 4096 cut some off
    maxTokens: 6000,
    temperature: 0.2,
    messages: [{ role: "user", content: taskMessage(input, extra) }],
  });
  // Agents sometimes write extra files; keep only the ones the task owns
  return { files: result.files.filter((f) => input.task.files.includes(f.path.replace(/^\.?\//, ""))), note: result.note };
}
