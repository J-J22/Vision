// The master prompt: the one document the build team works from.
// It describes the app and gives every agent its job, written from the Blueprint and the council's outcome.
import { callText } from "../llm";
import { config } from "../config";
import type { Blueprint, Minutes } from "../types";

export const AGENT_JOBS = ["Architect", "Backend developer", "Frontend developer", "Designer", "QA tester", "Debugger"] as const;

const SYSTEM = `You write the MASTER PROMPT for an AI developer team: one Markdown document they will build a web app from.
Be specific and concrete; no filler. Use exactly these sections:

# <App name>
One paragraph: what it is, for whom, and the single thing it must do well.

## Users and roles
Each role and what it can do.

## Features (first version)
Numbered. For each: what it does, then "Done when:" with 2-4 testable acceptance criteria.

## Screens
Each page: purpose and main elements.

## Data
Each entity with its fields.

## Rules and edge cases
Permissions, validation, money rules, what happens when things go wrong (sold out, duplicates, cancellations, empty states).

## Design brief
Feel, colors, typography direction, devices, references.

## Agent assignments
One subsection per agent: ${AGENT_JOBS.join(", ")}. For each: their job on THIS app, what they deliver, and what they must check before handing over.

## Decisions and defaults
What the owner decided, then what was decided by default (marked "default").

## Open risks
Anything the council disagreed on.`;

export async function writeMasterPrompt(blueprint: Blueprint, minutes: Minutes, consensus: string[], asked: { question: string; answer: string }[]) {
  return callText({
    label: "master prompt",
    model: config.models.big,
    maxTokens: 3500,
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          blueprint,
          councilConsensus: consensus,
          ownerAnswers: asked,
          decisions: minutes.decisions,
          defaults: minutes.defaults.slice(-20),
          disagreements: minutes.disagreements.slice(-8),
        }),
      },
    ],
  });
}
