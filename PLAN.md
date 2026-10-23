# Vision: 15-hour build plan

**Window:** 16:00 → 07:00. **Team:** 3 developers. **Models:** Groq.

## The one goal

By **01:00**, run this flow end to end once, even if it looks rough:

> User chats → Discovery asks about them and the app → Blueprint fills in live → user clicks Approve →
> AI project manager makes a task list → 3 agents write the code → tests run → the marketplace app opens in a preview.

Everything after 01:00 is polish. Discovery is never cut.

## Scope

| In | Out (mention in the pitch as "next") |
|---|---|
| One app type: marketplace | Other app types |
| One fixed stack for generated apps | User-chosen stacks |
| 4 agents: planner, backend, frontend, QA | Security, devops, reviewer agents |
| ~10 curated edge-case tests, 1 fix retry | "All edge cases" |
| Local preview of the generated app | Real cloud deploy (stretch goal only) |

## Architecture

```
Vision web app (Next.js, TypeScript)
├── /discovery   chat on the left, Blueprint + coverage checklist on the right
├── /build       live task board, agent activity feed, preview link
└── API routes
    ├── POST /api/discovery     one chat turn → { reply, blueprintPatch, coverage, done }
    ├── POST /api/build         Blueprint → planner → task list → starts the runner
    └── GET  /api/build/events  Server-Sent Events: task updates, agent messages, test results

lib/llm.ts        Groq wrapper: JSON output, schema validation, retry, rate-limit backoff
lib/agents/       prompts: discovery, planner, backend, frontend, qa
lib/runner.ts     runs tasks whose dependencies are done (max 2–3 at once), writes files
lib/sandbox.ts    copies the template into workspaces/<id>/, runs the app and tests

templates/marketplace/   working starter app the agents extend (deps pre-installed)
workspaces/<id>/         each generated app (gitignored)
```

**Generated app stack (fixed):** Express + SQLite (`better-sqlite3`) + plain HTML/JS pages, with no build step.
It starts in about a second, open models write it reliably, and there is no `npm install` during the demo.

**Sandbox:** for the hackathon, each generated app runs as a local child process in its own folder and port.
Use Docker only if there is spare time. Say "sandboxed" in the pitch only if Docker is actually in use.

## Shared contracts (agree on these in the first hour, then don't change them)

```ts
// lib/types.ts
type Level = "beginner" | "some-tech" | "developer";

type Blueprint = {
  user: { role: string; level: Level; goal: string };
  app: { name: string; type: "marketplace"; summary: string };
  roles: { name: string; can: string[] }[];                 // buyer, seller, admin
  features: { name: string; mvp: boolean; stories: string[] }[];
  pages: { path: string; purpose: string }[];
  entities: { name: string; fields: { name: string; type: string }[] }[];
  endpoints: { method: string; path: string; auth: string; purpose: string }[];
  auth: { method: string };
  payments: { mode: string };                               // mocked in the generated app
  nonFunctional: { users: string; region: string };
  assumptions: string[];                                    // defaults the AI chose
};

type Coverage = Record<
  "users" | "features" | "pages" | "data" | "api" | "auth" | "payments" | "scale" | "hosting",
  "missing" | "defaulted" | "answered"
>;

type Task = {
  id: string;                       // "T1"
  agent: "backend" | "frontend" | "qa";
  title: string;
  dependsOn: string[];
  files: string[];                  // files this task may write
  status: "waiting" | "running" | "done" | "failed";
};

type AgentOutput = {
  files: { path: string; content: string }[];
  note: string;                     // a message to the other agents, shown in the feed
};

type BuildEvent =
  | { type: "task"; task: Task }
  | { type: "message"; agent: string; text: string }
  | { type: "test"; name: string; passed: boolean; detail?: string }
  | { type: "preview"; url: string };
```

## Who does what

Each person owns one stage end to end: its AI prompts, its server code and its screen.

| | Person 1: Discovery, then QA | Person 2: Build pipeline (Groq owner) | Person 3: Code writers and sandbox |
|---|---|---|---|
| 16:00–17:00 | Next.js scaffold, `lib/types.ts`, `lib/sample-blueprint.json`; push by 16:45 | `lib/llm.ts` Groq wrapper returning validated JSON; push by 17:00 | Marketplace starter template that runs |
| 17:00–21:00 | Discovery prompt (profile questions first, then the checklist, level-adapted wording), `/api/discovery`, chat UI, live Blueprint panel | Planner agent (Blueprint → tasks), `runner.ts` with fake agents, `/api/build` + event stream | Backend and frontend agents; `sandbox.ts`: create workspace, write files, start and stop the app |
| **21:00** | **Checkpoint 1:** Discovery produces a full Blueprint in ≤10 turns | **Checkpoint 1:** fake agents run in dependency order, events stream | **Checkpoint 1:** backend agent code runs in a workspace |
| 21:30–01:00 | Approve button; ~10 edge-case tests; QA agent | Plug in the real agents; `/build` task board and agent feed | `runTests`; preview panel; clean up old processes |
| **01:00** | **Checkpoint 2: the full flow works once, as a team** | | |
| 01:00–04:00 | Double-buy demo moment; Discovery polish | Fix loop (failed test → fix task, 1 retry); reliability runs | Tune code-writing prompts; stretch: one-command deploy |
| 04:00–05:30 | **Feature freeze.** Run the full demo 3 times. Fix crashes only. | | Record the best run as a backup video |
| 05:30–07:00 | Drive the live demo | Explain the agent team | README, slides; sleep in turns |

## Groq: limits to plan around

- **Rate limits** (tokens and requests per minute) are the main risk with several agents running. Keep at most 2–3 agent calls running at once, keep prompts short, and back off and retry on HTTP 429.
- **Keep contexts small.** Give each agent only its slice of the Blueprint plus the files it needs, not the whole project.
- **Validate JSON.** Use JSON mode, check the output against the schema, and on failure retry once with the error message included.
- **Code quality** of open models is below the top proprietary ones. That is why agents extend a template and write small files.
- **Speed is the upside.** Groq is very fast. Show it off in the live Discovery chat.
- Use a bigger model for planner and backend, and a smaller, faster one for Discovery chat and QA. Keep a fallback model name in config.

## If behind at 01:00, cut in this order

1. Fix loop → just run the tests and show the results
2. Parallel agents → run tasks one by one (the task board still shows the dependencies)
3. Live preview → show the generated files and passing tests
4. Never cut Discovery or the Blueprint

## Demo script (3 minutes)

1. "I want to build a marketplace for second-hand textbooks." Discovery asks who you are. Answer "I'm not technical."
2. Show a question asked in simple language, with a recommended option. The Blueprint fills in on the right.
3. Approve. The task board appears and agents leave each other notes ("backend: /api/listings is ready").
4. QA catches the double-purchase bug, the backend agent fixes it, and the test turns green.
5. Open the generated marketplace and buy an item.
6. Close: "Next: more app types, a security agent, one-click cloud deploy."
