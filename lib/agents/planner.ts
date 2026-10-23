// The AI project manager: turns a Blueprint into a task list with owners and dependencies.
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import { checkPath } from "../sandbox";
import type { Blueprint, Minutes, Task } from "../types";

// The core marketplace every build needs. The planner adapts it and adds tasks for extra features.
export const DEFAULT_PLAN: Omit<Task, "status">[] = [
  { id: "T1", agent: "backend", title: "Create the listings and orders tables", dependsOn: [], files: ["db/010_market.sql"] },
  { id: "T2", agent: "backend", title: "Listings API: browse, search, create, edit, delete", dependsOn: ["T1"], files: ["routes/010_listings.js"] },
  { id: "T3", agent: "backend", title: "Orders, payments and refunds API", dependsOn: ["T1"], files: ["routes/020_orders.js"] },
  { id: "T4", agent: "frontend", title: "Site name, navigation and home page with search", dependsOn: ["T2"], files: ["public/site.js", "public/index.html"] },
  { id: "T5", agent: "frontend", title: "Listing page with a Buy button", dependsOn: ["T2", "T3"], files: ["public/listing.html"] },
  { id: "T6", agent: "frontend", title: "Sell page for creating a listing", dependsOn: ["T2"], files: ["public/sell.html"] },
  { id: "T7", agent: "frontend", title: "My orders page with pay and refund", dependsOn: ["T3"], files: ["public/orders.html"] },
];

const REQUIRED_FILES = ["db/010_market.sql", "routes/010_listings.js", "routes/020_orders.js"];

const PlanSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      agent: z.enum(["backend", "frontend"]),
      title: z.string(),
      dependsOn: z.array(z.string()).default([]),
      files: z.array(z.string()).min(1),
    }),
  ),
});

const SYSTEM = `You are the project manager of an AI developer team building a marketplace web app.
Turn the Blueprint into a task list. Each task is done by one agent:
- "backend" writes SQL files in db/ and Express route files in routes/
- "frontend" writes HTML pages in public/ (and public/site.js)

Start from the BASE PLAN. Keep all of its tasks and files (the core API is required and tested).
You may reword titles to fit this app. Then add tasks for the Blueprint's other MVP features
(e.g. reviews, messages, categories, favourites), usually one backend task and one frontend task per feature.
New SQL files are numbered from db/030_..., new routes from routes/030_..., e.g. db/030_reviews.sql + routes/030_reviews.js.

Rules:
- Each task writes 1-2 files. Every file belongs to exactly one task.
- dependsOn lists only ids of earlier tasks. Frontend tasks depend on the backend tasks whose API they call.
- At most 12 tasks. Skip features marked mvp: false.
Return {"tasks": [{"id": "T1", "agent": "backend", "title": "...", "dependsOn": [], "files": ["db/010_market.sql"]}, ...]}`;

function clean(raw: z.infer<typeof PlanSchema>["tasks"]): Omit<Task, "status">[] | null {
  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();
  const out: Omit<Task, "status">[] = [];
  for (const t of raw) {
    if (seenIds.has(t.id)) continue;
    const files = t.files
      .map((f) => checkPath(f))
      .filter((c): c is { ok: true; path: string } => c.ok)
      .map((c) => c.path)
      .filter((f) => !seenFiles.has(f));
    if (!files.length) continue;
    files.forEach((f) => seenFiles.add(f));
    // Only allow dependencies on earlier tasks, which also rules out cycles
    out.push({ ...t, files, dependsOn: t.dependsOn.filter((d) => seenIds.has(d)) });
    seenIds.add(t.id);
  }
  return REQUIRED_FILES.every((f) => seenFiles.has(f)) ? out : null;
}

export async function planTasks(blueprint: Blueprint, minutes?: Minutes): Promise<Task[]> {
  let plan: Omit<Task, "status">[] | null = null;
  if (!config.fakeAgents) {
    try {
      const result = await callLLM({
        label: "planner",
        model: config.models.big,
        system: SYSTEM,
        schema: PlanSchema,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              blueprint: { app: blueprint.app, roles: blueprint.roles, features: blueprint.features, pages: blueprint.pages, entities: blueprint.entities },
              decisions: minutes?.decisions ?? [],
              basePlan: DEFAULT_PLAN,
            }),
          },
        ],
      });
      plan = clean(result.tasks);
      if (!plan) console.warn("[planner] plan dropped required core files, using the base plan");
    } catch (err) {
      console.warn(`[planner] failed, using the base plan: ${err}`);
    }
  }
  const tasks = (plan ?? DEFAULT_PLAN).map((t) => ({ ...t, status: "waiting" as const }));
  // QA always runs last
  tasks.push({ id: "QA", agent: "qa" as const, title: "Run the edge-case tests", dependsOn: tasks.map((t) => t.id), files: [], status: "waiting" });
  return tasks;
}
