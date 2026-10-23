// Shared data formats. Agree before changing anything here: every stage depends on these.
import { z } from "zod";

export const LEVELS = ["beginner", "some-tech", "developer"] as const;
export type Level = (typeof LEVELS)[number];

export const AREAS = ["users", "features", "pages", "data", "api", "auth", "payments", "scale", "hosting", "design"] as const;
export type Area = (typeof AREAS)[number];

// ---------- Blueprint ----------
// Lenient on purpose: models often omit fields, so everything has a default.

const str = z.string().default("");
const strList = z.array(z.string()).default([]);

export const BlueprintSchema = z.object({
  user: z.object({ role: str, level: z.enum(LEVELS).default("beginner"), goal: str }).default({}),
  app: z.object({ name: str, type: z.string().default("marketplace"), summary: str }).default({}),
  roles: z.array(z.object({ name: str, can: strList })).default([]),
  features: z.array(z.object({ name: str, mvp: z.boolean().default(true), stories: strList })).default([]),
  pages: z.array(z.object({ path: str, purpose: str })).default([]),
  entities: z
    .array(z.object({ name: str, fields: z.array(z.object({ name: str, type: z.string().default("text") })).default([]) }))
    .default([]),
  endpoints: z.array(z.object({ method: z.string().default("GET"), path: str, auth: z.string().default("none"), purpose: str })).default([]),
  auth: z.object({ method: str }).default({}),
  payments: z.object({ mode: str }).default({}),
  nonFunctional: z.object({ users: str, region: str, hosting: str }).default({}),
  design: z.object({ feel: str, colors: str, references: str, devices: str }).default({}),
  assumptions: strList,
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

export const emptyBlueprint = (): Blueprint => BlueprintSchema.parse({});

export type Coverage = Record<Area, "missing" | "defaulted" | "answered">;

// ---------- User profile ----------

export type Profile = {
  role: string;
  codes: string; // "no" | "a little" | "yes"
  builtBefore: string;
  goal: string;
  level: Level;
};

// ---------- Parliament ----------

export type MemberRole = "architect" | "product" | "security" | "skeptic";

export const ConcernSchema = z.object({
  area: z.string().default("features"),
  question: z.string(),
  why: z.string().default(""),
  severity: z.enum(["blocking", "important", "nice"]).default("important"),
});
export type Concern = z.infer<typeof ConcernSchema>;

export type MemberReview = {
  role: MemberRole;
  model: string;
  summary: string; // one-line stance, shown on the member card
  concerns: Concern[];
  scores: Partial<Record<Area, number>>; // 1–5
  error?: string;
};

export type UserQuestion = {
  id: string;
  area: string;
  text: string; // already worded for the user's level
  why: string;
  options: { label: string; recommended?: boolean }[];
  multi?: boolean; // several options can be picked at once
  askedBy?: string; // council seat that raised it
  blocking?: boolean;
};

export type ParliamentRound = {
  round: number;
  reviews: MemberReview[];
  questions: UserQuestion[];
  defaults: string[];
  confidence: number; // 0–1
  areaConfidence: Record<Area, number>;
  done: boolean;
};

export type Minutes = {
  decisions: string[];
  defaults: string[];
  disagreements: string[];
};

// ---------- Build ----------

export type AgentName = "backend" | "frontend" | "qa";

export type Task = {
  id: string; // "T1"
  agent: AgentName;
  title: string;
  dependsOn: string[];
  files: string[]; // files this task may write
  status: "waiting" | "running" | "done" | "failed";
};

export type AgentOutput = {
  files: { path: string; content: string }[];
  note: string; // message to the other agents, shown in the feed
};

export type TestResult = { name: string; passed: boolean; detail?: string; file?: string }; // file: the page a browser test blames

export type BuildEvent =
  | { type: "task"; task: Task }
  | { type: "message"; agent: string; text: string }
  | { type: "test"; name: string; passed: boolean; detail?: string }
  | { type: "preview"; url: string }
  | { type: "status"; status: "planning" | "building" | "testing" | "fixing" | "done" | "failed"; detail?: string };

// ---------- Project flow (chat → council → master prompt → build) ----------

export type Stage = "discovery" | "council" | "master" | "build";

export type ChatMessage = {
  id: string;
  from: "vision" | "user" | MemberRole | "designer";
  text: string;
  // For a question: the answer choices, which one is recommended, and why it matters
  options?: { label: string; recommended?: boolean }[];
  multi?: boolean; // several options can be picked at once
  why?: string;
  questionId?: string;
  at: string;
};

export type CouncilSeat = "architect" | "product" | "security" | "skeptic" | "designer";

export type CouncilMessage = {
  n: number;
  from: CouncilSeat | "moderator";
  type: "claim" | "verify" | "challenge" | "concede" | "info";
  msg: string;
  analysis?: string; // the seat's longer reasoning for this turn
  at: string;
};

export type CouncilRound = {
  round: number;
  status: "running" | "done" | "failed";
  phase: "blind" | "debate" | "synthesis" | "closed";
  speaking?: CouncilSeat;
  sealed: CouncilSeat[]; // blind claims submitted but not yet revealed
  messages: CouncilMessage[];
  synthesis?: string;
  consensus: string[]; // what the council agreed on
  disagreements: string[];
  questions: UserQuestion[]; // for the user, already worded for their level
  defaults: string[];
  agreement: number; // 0–1, from verify/concede vs challenge
  confidence: number; // 0–1
  areaConfidence?: Record<Area, number>;
  engine: "crossexam" | "fallback";
  error?: string;
};
