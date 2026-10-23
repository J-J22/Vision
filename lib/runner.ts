// Runs a build: plan → agents in dependency order → start the app → tests → fix loop.
// Every step is published as a BuildEvent; /api/build/[id]/events streams them to the browser.
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { planTasks, type Endpoint } from "./agents/planner";
import { runCoder } from "./agents/coders";
import { reviewFailures, writeTests, type EdgeTest } from "./agents/qa";
import { buildFrontend, createWorkspace, readWorkspace, runTests, startApp, validateFiles, writeFiles } from "./sandbox";
import type { Blueprint, BuildEvent, Minutes, Task, TestResult } from "./types";

export type Build = {
  id: string;
  blueprint: Blueprint;
  minutes?: Minutes;
  masterPrompt?: string; // the approved master prompt (shown on the build page; agents get their slice via the Blueprint)
  tasks: Task[];
  api: Endpoint[]; // the contract the planner designed; agents build to it, tests check it
  tests: EdgeTest[]; // written by QA from the contract before any code
  events: BuildEvent[];
  listeners: Set<(e: BuildEvent) => void>;
  notes: { agent: string; text: string }[];
  previewUrl?: string;
};

const MAX_PARALLEL = 2;

const g = globalThis as unknown as { __visionBuilds?: Map<string, Build> };
const builds = (g.__visionBuilds ??= new Map());

export function getBuild(id: string) {
  return builds.get(id);
}

function emit(build: Build, event: BuildEvent) {
  build.events.push(event);
  for (const l of build.listeners) l(event);
}

function setTask(build: Build, task: Task, status: Task["status"]) {
  task.status = status;
  emit(build, { type: "task", task: { ...task } });
}

function say(build: Build, agent: string, text: string) {
  build.notes.push({ agent, text });
  emit(build, { type: "message", agent, text });
}

async function runTask(build: Build, task: Task, fix?: string) {
  setTask(build, task, "running");
  try {
    let instructions = fix;
    // Two attempts: if the code doesn't pass the quick checks, the agent gets the errors and tries once more
    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await runCoder({ buildId: build.id, task, blueprint: build.blueprint, minutes: build.minutes, notes: build.notes, api: build.api, tests: build.tests, planned: build.tasks.filter((t) => t.agent !== "qa").map((t) => `${t.id} ${t.agent}: ${t.title} (${t.files.join(", ")})`).join("\n"), fix: instructions });
      const { written, rejected } = writeFiles(build.id, out.files);
      if (rejected.length) say(build, "system", `Ignored files outside the rules: ${rejected.join("; ")}`);
      if (!written.length && !config.fakeAgents) throw new Error("The agent didn't write any of its files");
      const problems = await validateFiles(build.id, written);
      if (!problems.length) {
        if (out.note) say(build, task.agent, out.note);
        setTask(build, task, "done");
        return;
      }
      say(build, "reviewer", `${task.id} needs changes: ${problems.join(" ")}`);
      if (attempt === 2) throw new Error(`Code still has problems after a retry: ${problems.join(" ")}`);
      instructions = `${fix ? `${fix}\n` : ""}Your files failed the automatic checks:\n- ${problems.join("\n- ")}`;
    }
  } catch (err) {
    say(build, task.agent, `Couldn't finish ${task.id}: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`);
    setTask(build, task, "failed");
  }
}

// Runs every task whose dependencies are done, at most MAX_PARALLEL at once
async function runCodingTasks(build: Build) {
  const coding = build.tasks.filter((t) => t.agent !== "qa");
  const running = new Map<string, Promise<void>>();
  while (true) {
    const done = new Set(coding.filter((t) => t.status === "done").map((t) => t.id));
    const blocked = new Set(coding.filter((t) => t.status === "failed").map((t) => t.id));
    for (const t of coding) {
      // A task whose dependency failed can't run
      if (t.status === "waiting" && t.dependsOn.some((d) => blocked.has(d))) setTask(build, t, "failed");
    }
    const ready = coding.filter((t) => t.status === "waiting" && t.dependsOn.every((d) => done.has(d)));
    for (const t of ready) {
      if (running.size >= MAX_PARALLEL) break;
      const p = runTask(build, t).finally(() => running.delete(t.id));
      running.set(t.id, p);
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
}

async function testApp(build: Build): Promise<TestResult[] | null> {
  const web = await buildFrontend(build.id);
  if (!web.ok) {
    say(build, "qa", `The frontend doesn't build. ${web.errors.slice(0, 600)}`);
    emit(build, { type: "test", name: "The frontend builds", passed: false, detail: web.errors });
  }
  try {
    const { url } = await startApp(build.id);
    build.previewUrl = url;
    emit(build, { type: "preview", url });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    say(build, "qa", `The app didn't start. ${message.slice(0, 600)}`);
    return [{ name: "The app starts", passed: false, detail: message.slice(0, 2000) }];
  }
  const results = await runTests(build.id, build.previewUrl!, build.tests);
  for (const r of results) emit(build, { type: "test", name: r.name, passed: r.passed, detail: r.detail });
  return results;
}

async function run(build: Build) {
  try {
    emit(build, { type: "status", status: "planning" });
    createWorkspace(build.id);
    const plan = await planTasks(build.blueprint, build.minutes);
    build.tasks = plan.tasks;
    build.api = plan.api;
    for (const t of build.tasks) emit(build, { type: "task", task: { ...t } });
    say(build, "planner", `Designed ${build.api.length} API endpoints and split the work into ${build.tasks.length - 1} tasks.`);

    // Tests first: QA writes them from the contract, and the developers see them while they code
    build.tests = await writeTests(build.blueprint, build.api);
    say(build, "qa", build.tests.length ? `Wrote ${build.tests.length} edge-case tests before any code: ${build.tests.map((t) => t.name).join("; ")}.` : "No API to test beyond the basics; I'll run the smoke tests.");

    emit(build, { type: "status", status: "building" });
    await runCodingTasks(build);

    const qa = build.tasks.find((t) => t.agent === "qa")!;
    setTask(build, qa, "running");
    emit(build, { type: "status", status: "testing" });
    let results = await testApp(build);

    for (let attempt = 0; attempt < config.fixRetries && results?.some((r) => !r.passed); attempt++) {
      const failures = results.filter((r) => !r.passed);
      // Pages that crash in the browser go back to the frontend agent; everything else to QA's review and the backend
      const pageFailures = failures.filter((f) => f.file?.startsWith("web/"));
      const apiFailures = failures.filter((f) => !f.file?.startsWith("web/"));
      const report = apiFailures.length ? await reviewFailures(apiFailures, readWorkspace(build.id), build.api) : { summary: "", fixes: [] };
      say(build, "qa", [report.summary, pageFailures.length ? `${pageFailures.length} page${pageFailures.length === 1 ? "" : "s"} crash in the browser: ${pageFailures.map((f) => f.name.replace("Page works in the browser: ", "")).join(", ")}.` : ""].filter(Boolean).join(" "));
      emit(build, { type: "status", status: "fixing" });

      for (const f of pageFailures) {
        const owner = build.tasks.find((t) => t.files.includes(f.file!));
        const fixTask: Task = { id: `FIX${attempt + 1}-${owner?.id ?? "page"}-${f.file!.split("/").pop()!.replace(".jsx", "")}`, agent: "frontend", title: `Fix ${f.file}`, dependsOn: [], files: [f.file!], status: "waiting" };
        build.tasks.push(fixTask);
        emit(build, { type: "task", task: { ...fixTask } });
        await runTask(build, fixTask, `This page crashes in the browser (tested by loading it and then navigating away):\n${f.detail}\nFind the cause (a bad effect cleanup, reading a field of undefined data, a wrong import or prop) and fix it. Guard against missing data while it loads.`);
      }

      // One fix task per backend file the QA agent pointed at; default to every route file the plan has
      const routeFiles = build.tasks.filter((t) => t.agent === "backend" && !t.id.startsWith("FIX")).flatMap((t) => t.files.filter((f) => f.startsWith("routes/")));
      const files = !apiFailures.length ? [] : report.fixes.length ? [...new Set(report.fixes.map((f) => f.file))] : routeFiles;
      let failureText = apiFailures.map((f) => `- ${f.name}: ${f.detail}`).join("\n");
      // The common first-run failure: the app made its own extra fields required, so every test that creates something
      // is refused. Fixing one field per round never finishes, so name the whole rule.
      if (apiFailures.some((f) => /got 400[^\n]*required|got 400[^\n]*missing/i.test(f.detail ?? ""))) {
        failureText +=
          "\nRoot cause: the app rejects requests that send only the fields in the API contract. Make EVERY field the contract" +
          " doesn't list (or marks with ?) optional in one go: remove all 'X is required' checks for them, and when inserting use" +
          " a default for any that are missing ('' for text, 0 for numbers), so NOT NULL columns still work.";
      }
      for (const file of files) {
        const owner = build.tasks.find((t) => t.files.includes(file));
        const fixTask: Task = {
          id: `FIX${attempt + 1}-${owner?.id ?? file}`,
          agent: "backend",
          title: `Fix ${file}`,
          dependsOn: [],
          files: [file],
          status: "waiting",
        };
        build.tasks.push(fixTask);
        emit(build, { type: "task", task: { ...fixTask } });
        const instructions = report.fixes.filter((f) => f.file === file).map((f) => f.instruction).join("\n");
        await runTask(build, fixTask, `${failureText}${instructions ? `\nQA's advice:\n${instructions}` : ""}`);
      }
      emit(build, { type: "status", status: "testing" });
      results = await testApp(build);
    }

    const passed = results?.filter((r) => r.passed).length ?? 0;
    const total = results?.length ?? 0;
    setTask(build, qa, passed === total ? "done" : "failed");
    say(build, "qa", `${passed} of ${total} edge-case tests pass.`);
    emit(build, { type: "status", status: "done", detail: `${passed}/${total} tests passing` });
  } catch (err) {
    console.error("[runner]", err);
    emit(build, { type: "status", status: "failed", detail: String(err instanceof Error ? err.message : err) });
  }
}

export function startBuild(blueprint: Blueprint, minutes?: Minutes, masterPrompt?: string): Build {
  const build: Build = {
    id: randomUUID().slice(0, 8),
    blueprint,
    minutes,
    masterPrompt,
    tasks: [],
    api: [],
    tests: [],
    events: [],
    listeners: new Set(),
    notes: [],
  };
  builds.set(build.id, build);
  void run(build);
  return build;
}
