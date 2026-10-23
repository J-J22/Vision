// The AI project manager: designs the app from the Blueprint. Returns the task list (owners, files, dependencies)
// and the API contract every agent builds to and the QA tester writes tests against. No app type is assumed.
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import { checkPath } from "../sandbox";
import type { Blueprint, Minutes, Task } from "../types";

const Endpoint = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  auth: z.enum(["public", "login", "owner"]).default("public"),
  body: z.string().default(""), // e.g. "{ title, description?, url? }": ? marks optional fields
  returns: z.string().default(""), // e.g. "201 { project }"
  rules: z.string().default(""), // validation and edge cases, e.g. "400 if title is blank or over 200 chars"
});
export type Endpoint = z.infer<typeof Endpoint>;

const PlanSchema = z.object({
  api: z.array(Endpoint).max(24),
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

const SYSTEM = `You are the project manager of an AI developer team. Design the web app described by the Blueprint:
whatever kind of app it is (portfolio, booking, community, tool, shop…), build what the user asked for, nothing generic.

The starter already has: an Express + SQLite server, users and login (/api/auth/register, /api/auth/login, /api/auth/me),
a login page at /login, shared JS helpers and base CSS. Agents add files:
- "backend" writes SQL in db/ (db/010_x.sql, db/020_y.sql…) and Express routes in routes/ (routes/010_x.js, routes/020_y.js…)
- "frontend" writes pages in public/ (public/index.html, public/about.html…), public/site.js and public/theme.css

1. "api": the API contract for this app's MVP features. One entry per endpoint:
   {"method": "POST", "path": "/api/projects", "auth": "login", "body": "{ title, description?, url? }",
    "returns": "201 { project }", "rules": "400 if title is blank or longer than 200 characters"}
   auth: "public" (anyone), "login" (any logged-in user), "owner" (only the user who created it; 403 for others).
   Use :id in paths. Lists return { items }. Keep it to what the MVP needs (usually 4-14 endpoints).
   A purely informational site may need only a few endpoints (e.g. a contact form, admin-editable content).
   If people sign in to create or manage things (sellers, hosts, members, owners), plan a dashboard: a stats endpoint
   such as GET /api/dashboard [login] -> { stats: {...}, recent: [...], series: [{ label, value }] } for their own data,
   and a dashboard page with stat cards, a chart and recent activity. If there's an admin role, an admin page too.
2. "tasks": who builds what.
   - T1 is always {"agent": "frontend", "title": "Theme and navigation", "files": ["public/theme.css", "public/site.js"]}.
   - Then backend tasks (1-2 files each: SQL + route for one area), then frontend pages (1-2 pages each).
   - The home page public/index.html belongs to exactly one frontend task.
   - dependsOn lists only ids of earlier tasks. Pages depend on the backend tasks whose API they call.
   - Every file belongs to exactly one task. At most 14 tasks. Skip features marked mvp: false.
Return {"api": [...], "tasks": [{"id": "T1", "agent": "frontend", "title": "...", "dependsOn": [], "files": ["..."]}, ...]}`;

const THEME_TASK: Omit<Task, "status"> = { id: "T1", agent: "frontend", title: "Theme and navigation", dependsOn: [], files: ["public/theme.css", "public/site.js"] };

function clean(raw: z.infer<typeof PlanSchema>["tasks"]): Omit<Task, "status">[] {
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
  // The theme comes first whatever the model did: every page builds on it
  if (!seenFiles.has("public/theme.css")) out.unshift(THEME_TASK);
  if (!seenFiles.has("public/index.html")) out.push({ id: "THOME", agent: "frontend", title: "Home page", dependsOn: out.map((t) => t.id), files: ["public/index.html"] });
  return out;
}

export async function planTasks(blueprint: Blueprint, minutes?: Minutes): Promise<{ tasks: Task[]; api: Endpoint[] }> {
  let plan: { tasks: Omit<Task, "status">[]; api: Endpoint[] } = { tasks: [THEME_TASK, { id: "T2", agent: "frontend", title: "Home page", dependsOn: ["T1"], files: ["public/index.html"] }], api: [] };
  if (!config.fakeAgents) {
    const result = await callLLM({
      label: "planner",
      slot: "manager",
      system: SYSTEM,
      schema: PlanSchema,
      maxTokens: 4096,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            app: blueprint.app,
            roles: blueprint.roles,
            features: blueprint.features.filter((f) => f.mvp).map((f) => ({ name: f.name, stories: f.stories })),
            pages: blueprint.pages,
            entities: blueprint.entities,
            design: blueprint.design,
            decisions: minutes?.decisions ?? [],
          }),
        },
      ],
    });
    plan = { tasks: clean(result.tasks), api: result.api };
  }
  const tasks: Task[] = plan.tasks.map((t) => ({ ...t, status: "waiting" as const }));
  // QA always runs last
  tasks.push({ id: "QA", agent: "qa", title: "Run the edge-case tests", dependsOn: tasks.map((t) => t.id), files: [], status: "waiting" });
  return { tasks, api: plan.api };
}

// The contract as compact lines for prompts: "POST /api/projects [login] body { title } -> 201 { project }. rules"
export function contractText(api: Endpoint[]): string {
  return api.map((e) => `${e.method} ${e.path} [${e.auth}]${e.body ? ` body ${e.body}` : ""}${e.returns ? ` -> ${e.returns}` : ""}${e.rules ? `. ${e.rules}` : ""}`).join("\n");
}
