// Discovery: learn who the user is, draft a Blueprint from their idea, and fold their answers back in.
import { z } from "zod";
import { callLLM } from "../llm";
import { BlueprintSchema, type Blueprint, type Level, type Profile } from "../types";

// Fixed questions: no model call needed, so the first screen is instant
export const PROFILE_QUESTIONS = [
  {
    id: "role",
    text: "What best describes you?",
    options: ["Founder or business owner", "Student", "Developer", "Designer or product person", "Something else"],
  },
  { id: "codes", text: "Do you write code?", options: ["No", "A little", "Yes, regularly"] },
  { id: "builtBefore", text: "Have you launched an app or website before?", options: ["No", "Yes, with help", "Yes, on my own"] },
  { id: "goal", text: "What do you want from this project?", options: ["Test an idea quickly", "Launch a real business", "Learn how apps are built", "A demo or hackathon"] },
] as const;

export function levelFromProfile(answers: Record<string, string>): Level {
  if (answers.codes === "Yes, regularly" || answers.role === "Developer") return "developer";
  if (answers.codes === "A little" || answers.builtBefore === "Yes, on my own") return "some-tech";
  return "beginner";
}

export function makeProfile(answers: Record<string, string>): Profile {
  return {
    role: answers.role ?? "",
    codes: answers.codes ?? "",
    builtBefore: answers.builtBefore ?? "",
    goal: answers.goal ?? "",
    level: levelFromProfile(answers),
  };
}

const BLUEPRINT_SHAPE = `Blueprint JSON shape:
{
  "user": { "role": "", "level": "beginner|some-tech|developer", "goal": "" },
  "app": { "name": "", "type": "marketplace|booking|social|saas|content|other", "summary": "" },
  "roles": [{ "name": "visitor", "can": ["..."] }],
  "features": [{ "name": "", "mvp": true, "stories": ["As a visitor I can ..."] }],
  "pages": [{ "path": "/", "purpose": "" }],
  "entities": [{ "name": "project", "fields": [{ "name": "title", "type": "text" }] }],
  "endpoints": [{ "method": "GET", "path": "/api/projects", "auth": "none|user|owner|admin", "purpose": "" }],
  "auth": { "method": "" },
  "payments": { "mode": "" },
  "nonFunctional": { "users": "", "region": "", "hosting": "" },
  "design": { "feel": "", "colors": "", "references": "", "devices": "" },
  "assumptions": ["things you guessed, in plain words"]
}`;

export async function draftBlueprint(idea: string, profile: Profile): Promise<Blueprint> {
  const result = await callLLM({
    label: "discovery draft",
    slot: "draft",
    schema: BlueprintSchema,
    system: `You are a senior product engineer. Turn a user's app idea into a first draft Blueprint for a web app.
Fill in only what the idea states or clearly implies. Leave fields empty when you'd be guessing about something
important (payments, who can sell, scale, login method): a review panel will ask the user about those.
Put any smaller guesses you make in "assumptions".
Always give the app a short, memorable name in "app.name" (2-3 words, no "App" suffix) if the user didn't name it.
${BLUEPRINT_SHAPE}`,
    messages: [{ role: "user", content: `User profile: ${JSON.stringify(profile)}\n\nTheir idea:\n${idea}` }],
  });
  return { ...result, user: { role: profile.role, level: profile.level, goal: profile.goal } };
}

const MergeSchema = z.object({
  blueprint: BlueprintSchema,
  decisions: z.array(z.string()).default([]),
});

export async function applyAnswers(
  blueprint: Blueprint,
  answers: { area: string; question: string; answer: string }[],
  defaults: string[],
): Promise<{ blueprint: Blueprint; decisions: string[] }> {
  return callLLM({
    label: "discovery merge",
    slot: "merge",
    schema: MergeSchema,
    system: `You maintain a Blueprint for a web app. Update it with the user's answers and the review panel's defaults.
Change only what the answers and defaults affect, and keep everything else. Add entities, endpoints and pages that new
features need. "decisions": one short line per answer, e.g. "Contact form messages go to the owner's email".
Return {"blueprint": {...}, "decisions": [...]}.
${BLUEPRINT_SHAPE}`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ blueprint, answers, defaultsToApply: defaults }),
      },
    ],
  });
}
