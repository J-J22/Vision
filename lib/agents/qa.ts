// The QA agent. Before any code exists it writes edge-case tests from the API contract (tests first, so the
// developers build to them). After the tests run, it explains failures in plain words and tells the backend what to fix.
import { z } from "zod";
import { callLLM } from "../llm";
import { config } from "../config";
import { contractText, type Endpoint } from "./planner";
import type { Blueprint, TestResult } from "../types";

// ---------- writing the tests ----------

const Step = z.object({
  as: z.enum(["anon", "alice", "bob"]).default("anon"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/api/"),
  body: z.record(z.string(), z.unknown()).optional(),
  expect: z.union([z.number(), z.array(z.number())]).transform((e) => [].concat(e as never) as number[]),
  save: z.record(z.string(), z.string()).optional(),
});
const TestsSchema = z.object({
  tests: z.array(z.object({ name: z.string(), area: z.string().default("api"), steps: z.array(Step).min(1).max(6) })).max(12),
});
export type EdgeTest = z.infer<typeof TestsSchema>["tests"][number];

const WRITE_SYSTEM = `You are the QA tester on an AI developer team. Before any code is written, write the automatic edge-case
tests for the app from its API CONTRACT. The developers build to the contract and see your tests.

Each test is a short sequence of HTTP steps. Users: "anon" (not logged in), "alice" and "bob" (registered and logged in
automatically). A step: {"as": "alice", "method": "POST", "path": "/api/projects", "body": {...}, "expect": [201],
"save": {"pid": "project.id"}}. "save" stores a value from the JSON response (dot path) for later steps as "{{pid}}".
"{{run}}" is unique per run (use it in names, emails or slugs that must be unique).
"{{long:N}}" becomes N characters: ALWAYS use it for too-long input (e.g. "message": "{{long:5001}}" when the limit is 5000);
never type long text yourself. Rate limits: send at most 3 requests to the same endpoint across all tests, unless the
test is about the rate limit itself (then make it the last test).

Write 6-10 tests that catch real bugs, using ONLY endpoints and fields in the contract. Cover what applies:
- a login-only endpoint called as anon -> 401
- invalid input (blank required text, a 5000-character title, negative numbers) -> 400
- bob changing or deleting alice's item -> 403 (create it as alice first, save its id)
- an id that doesn't exist (999999) -> 404
- the happy path: create -> 201, then read it back -> 200
- unicode and emoji content (e.g. "Café ☕ 📚") stored and read back
- an empty list returns 200, and anything the app's rules forbid (duplicates, double actions) -> 409 or 400
Every step's body sends only the fields the contract lists (others are optional). Expect exactly the contract's statuses.
Name each test as a plain sentence a non-technical person understands ("Nobody can edit someone else's project").
Return {"tests": [{"name": "...", "area": "auth|validation|permissions|api|data", "steps": [...]}]}`;

export async function writeTests(blueprint: Blueprint, api: Endpoint[]): Promise<EdgeTest[]> {
  if (config.fakeAgents || !api.length) return [];
  try {
    const result = await callLLM({
      label: "qa tests",
      slot: "qa",
      system: WRITE_SYSTEM,
      schema: TestsSchema,
      maxTokens: 4096,
      messages: [{ role: "user", content: `APP: ${blueprint.app.name}: ${blueprint.app.summary}\n\nAPI CONTRACT:\n${contractText(api)}` }],
    });
    // A test may only call paths from the contract; drop the rest rather than fail builds on a made-up endpoint
    const known = api.map((e) => new RegExp(`^${e.path.replace(/:[^/]+/g, "[^/]+")}(\\?.*)?$`));
    return result.tests.filter((t) => t.steps.every((s) => known.some((re) => re.test(s.path.replace(/\{\{\w+\}\}/g, "1")))));
  } catch (err) {
    console.warn(`[qa] couldn't write tests: ${err}`);
    return [];
  }
}

// The tests as compact text for the developers' prompts
export function testsText(tests: EdgeTest[]): string {
  return tests
    .map((t) => `- ${t.name}: ${t.steps.map((s) => `${s.as} ${s.method} ${s.path}${s.body ? ` ${JSON.stringify(s.body)}` : ""} => ${s.expect.join("|")}`).join("; ")}`)
    .join("\n");
}

// ---------- reviewing failures ----------

const QaSchema = z.object({
  summary: z.string(),
  fixes: z.array(z.object({ file: z.string(), instruction: z.string() })).default([]),
});
export type QaReport = z.infer<typeof QaSchema>;

const SYSTEM = `You are the QA tester on an AI developer team. Automatic edge-case tests ran against the app the team built.
For the failed tests:
- "summary": one or two plain sentences a non-technical person understands (e.g. "Anyone could delete someone else's project.")
- "fixes": for each file that must change, a precise instruction for the backend developer.
Only name files in routes/ or db/. Return {"summary": "...", "fixes": [{"file": "routes/010_projects.js", "instruction": "..."}]}`;

export async function reviewFailures(failures: TestResult[], files: Record<string, string>, api: Endpoint[] = []): Promise<QaReport> {
  const fallback: QaReport = {
    summary: `${failures.length} test${failures.length === 1 ? "" : "s"} failed: ${failures.map((f) => f.name).join("; ")}.`,
    fixes: [],
  };
  if (config.fakeAgents) return fallback;
  try {
    return await callLLM({
      label: "qa",
      slot: "qa",
      system: SYSTEM,
      schema: QaSchema,
      messages: [
        {
          role: "user",
          content: `API CONTRACT:\n${contractText(api)}\n\nFAILED TESTS:\n${failures.map((f) => `- ${f.name}: ${f.detail}`).join("\n")}\n\nBACKEND FILES:\n${Object.entries(files)
            .filter(([p]) => (p.startsWith("routes/") || p.startsWith("db/")) && !p.startsWith("routes/00") && p !== "db/001_core.sql")
            .map(([p, c]) => `--- ${p}\n${c.slice(0, 4000)}`)
            .join("\n\n")}`,
        },
      ],
    });
  } catch (err) {
    console.warn(`[qa] failed: ${err}`);
    return fallback;
  }
}
