// Each build gets its own copy of the starter app (server, database, login, base styles) in workspaces/<id>/.
// The generated app runs as a separate Node process on its own port.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, posix, relative, resolve } from "node:path";
import type { TestResult } from "./types";

const ROOT = process.cwd();
const TEMPLATE = join(ROOT, "templates", "starter");
const WORKSPACES = join(ROOT, "workspaces");
const TESTS = join(ROOT, "tests", "edge-cases", "run.mjs");

// Folders (and single files) agents may write to, and starter files inside them they must not touch
const WRITABLE = ["db/", "routes/", "web/src/pages/", "web/src/components/", "web/src/theme.css", "web/src/site.js"];
const PROTECTED = new Set([
  "db/001_core.sql",
  "routes/000_health.js",
  "routes/001_auth.js",
  "web/src/components/ui.jsx",
  "web/src/pages/Login.jsx",
  "web/src/pages/NotFound.jsx",
]);

type Running = { proc: ChildProcess; port: number; logs: string[] };

// Survive Next.js hot reloads in dev
const g = globalThis as unknown as { __visionApps?: Map<string, Running> };
const apps = (g.__visionApps ??= new Map());

export function workspacePath(id: string) {
  return join(WORKSPACES, id);
}

export function createWorkspace(id: string) {
  if (!existsSync(join(TEMPLATE, "node_modules"))) {
    throw new Error("Template packages missing. Run `npm run setup` once.");
  }
  const dir = workspacePath(id);
  mkdirSync(WORKSPACES, { recursive: true });
  cpSync(TEMPLATE, dir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(TEMPLATE, src);
      return !rel.startsWith("node_modules") && !rel.includes("data.sqlite");
    },
  });
  // "junction" works on Windows without admin rights; other systems ignore the type
  symlinkSync(join(TEMPLATE, "node_modules"), join(dir, "node_modules"), "junction");
  return dir;
}

// Returns the normalized path, or an error message if the agent may not write there
export function checkPath(path: string): { ok: true; path: string } | { ok: false; error: string } {
  // Agents always use forward slashes; normalize the same way on every OS
  const clean = posix.normalize(path.replace(/\\/g, "/")).replace(/^\.?\/+/, "");
  if (clean.startsWith("..") || clean.includes("/../")) return { ok: false, error: `${path}: path leaves the app folder` };
  if (!WRITABLE.some((w) => (w.endsWith("/") ? clean.startsWith(w) : clean === w))) return { ok: false, error: `${path}: agents may only write to ${WRITABLE.join(", ")}` };
  if (PROTECTED.has(clean)) return { ok: false, error: `${path}: this starter file must not be changed` };
  return { ok: true, path: clean };
}

export function writeFiles(id: string, files: { path: string; content: string }[]) {
  const dir = workspacePath(id);
  const written: string[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const check = checkPath(f.path);
    if (!check.ok) {
      rejected.push(check.error);
      continue;
    }
    const target = resolve(dir, check.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
    written.push(check.path);
  }
  return { written, rejected };
}

// Checks files an agent just wrote, before the app ever starts. Returns problems in words an agent can act on.
const FRONTEND_PACKAGES = /^(react|react-dom|react-router-dom|lucide-react|recharts|clsx)(\/|$)/;

export async function validateFiles(id: string, paths: string[]): Promise<string[]> {
  const dir = workspacePath(id);
  const problems: string[] = [];
  for (const path of paths.filter((p) => p.endsWith(".js") && p.startsWith("routes/"))) {
    const code = readFileSync(join(dir, path), "utf8");
    for (const m of code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g)) {
      const pkg = m[1] ?? m[2];
      if (pkg !== "express" && !pkg.startsWith("node:") && !pkg.startsWith("../lib/")) {
        problems.push(`${path} imports "${pkg}", which isn't installed. Remove the import and use what's passed in ({ db, tx, requireAuth, optionalAuth }) or a node: built-in.`);
      }
    }
    const check = spawnSync(process.execPath, ["--check", join(dir, path)], { encoding: "utf8" });
    if (check.status !== 0) problems.push(`${path} has a syntax error: ${check.stderr.split("\n").slice(0, 5).join(" ").slice(0, 400)}`);
  }
  // Run every SQL file, in order, against an empty in-memory database
  if (paths.some((p) => p.endsWith(".sql"))) {
    const script = `const { DatabaseSync } = require("node:sqlite"); const fs = require("node:fs"); const db = new DatabaseSync(":memory:");
      for (const f of fs.readdirSync("db").filter((f) => f.endsWith(".sql")).sort()) {
        try { db.exec(fs.readFileSync("db/" + f, "utf8")); } catch (e) { console.error("db/" + f + ": " + e.message); process.exit(1); }
      }`;
    const run = spawnSync(process.execPath, ["-e", script], { cwd: dir, encoding: "utf8" });
    if (run.status !== 0) problems.push(`SQL error: ${run.stderr.trim().split("\n").pop()?.slice(0, 400)}`);
  }
  // React pages: only the installed packages, then a real build (catches JSX and import mistakes)
  const web = paths.filter((p) => p.startsWith("web/"));
  for (const path of web.filter((p) => p.endsWith(".jsx") || p.endsWith(".js"))) {
    const code = readFileSync(join(dir, path), "utf8");
    for (const m of code.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)) {
      if (!m[1].startsWith(".") && !FRONTEND_PACKAGES.test(m[1])) {
        problems.push(`${path} imports "${m[1]}", which isn't installed. Use react, react-router-dom, lucide-react, recharts, clsx or ../components/ui.jsx.`);
      }
    }
  }
  if (web.length && !problems.length) {
    const build = await buildFrontend(id);
    if (!build.ok) problems.push(`The frontend doesn't build:\n${build.errors}`);
  }
  return problems;
}

// All files agents can see, as { path: content }, skipping the starter internals
export function readWorkspace(id: string, entries = WRITABLE): Record<string, string> {
  const dir = workspacePath(id);
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const full = join(dir, entry);
    if (!existsSync(full)) continue;
    if (!entry.endsWith("/")) {
      out[entry] = readFileSync(full, "utf8");
      continue;
    }
    for (const name of readdirSync(full)) {
      if (PROTECTED.has(`${entry}${name}`)) continue;
      out[`${entry}${name}`] = readFileSync(join(full, name), "utf8");
    }
  }
  return out;
}

// Builds the React frontend (web/ -> web/dist). One build at a time per app, since builds share the output folder.
const buildQueue = new Map<string, Promise<unknown>>();
export function buildFrontend(id: string): Promise<{ ok: boolean; errors: string }> {
  const run = () =>
    new Promise<{ ok: boolean; errors: string }>((res) => {
      const proc = spawn(process.execPath, [join(TEMPLATE, "node_modules", "vite", "bin", "vite.js"), "build", "web"], { cwd: workspacePath(id), stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const timer = setTimeout(() => proc.kill(), 120_000);
      proc.stdout.on("data", (c) => (out += c));
      proc.stderr.on("data", (c) => (out += c));
      proc.on("exit", (code) => {
        clearTimeout(timer);
        // Keep the part that names the file and line, not Vite's banner
        const errors = out.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => l.trim() && !/^vite v|transforming|rendering chunks|computing gzip|^dist\//.test(l)).join("\n");
        res({ ok: code === 0, errors: errors.slice(-1500) });
      });
    });
  const next = (buildQueue.get(id) ?? Promise.resolve()).then(run, run);
  buildQueue.set(id, next);
  return next;
}

// The rulebook, cut down to the sections an agent needs (smaller prompts fit Groq's limits)
const SECTIONS: Record<string, string[]> = {
  backend: ["Where files go", "Database", "Route file shape", "Errors", "The API contract"],
  frontend: ["Where files go", "The API contract", "Pages", "Theme"],
};

export function conventions(agent?: "backend" | "frontend"): string {
  const text = readFileSync(join(TEMPLATE, "CONVENTIONS.md"), "utf8");
  if (!agent) return text;
  const [intro, ...sections] = text.split(/^## /m);
  const keep = sections.filter((sec) => SECTIONS[agent].some((name) => sec.startsWith(name)));
  return [intro.trim(), ...keep.map((sec) => `## ${sec.trim()}`)].join("\n\n");
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
    srv.on("error", rej);
  });
}

export function stopApp(id: string) {
  const app = apps.get(id);
  if (app) {
    app.proc.kill();
    apps.delete(id);
  }
}

export function appLogs(id: string): string {
  return apps.get(id)?.logs.join("") ?? "";
}

// Starts the generated app and waits until /api/health answers. Throws with the app's logs if it crashes.
export async function startApp(id: string): Promise<{ url: string }> {
  stopApp(id);
  // Keep at most 5 generated apps running so ports and memory don't run out
  if (apps.size >= 5) stopApp(apps.keys().next().value!);

  const port = await freePort();
  const logs: string[] = [];
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: workspacePath(id),
    env: { ...process.env, PORT: String(port), RESET_DB: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keep = (chunk: Buffer) => {
    logs.push(chunk.toString());
    if (logs.length > 200) logs.shift();
  };
  proc.stdout?.on("data", keep);
  proc.stderr?.on("data", keep);
  apps.set(id, { proc, port, logs });

  let exited = false;
  proc.on("exit", () => (exited = true));

  const url = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    if (exited) throw new Error(`The generated app crashed on start:\n${logs.join("").slice(-3000)}`);
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url };
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  stopApp(id);
  throw new Error(`The generated app didn't answer within 10 seconds:\n${logs.join("").slice(-3000)}`);
}

// Runs the QA agent's tests (saved beside the app, out of the agents' reach) plus the built-in smoke tests
export async function runTests(id: string, url: string, tests: unknown[]): Promise<TestResult[]> {
  const file = join(workspacePath(id), ".vision-tests.json");
  writeFileSync(file, JSON.stringify(tests, null, 1));
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [TESTS, url, file, join(workspacePath(id), "web", "dist")], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => proc.kill(), 60000);
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("exit", () => {
      clearTimeout(timer);
      try {
        res(JSON.parse(out.trim().split("\n").pop() ?? "[]"));
      } catch {
        rej(new Error(`Tests didn't produce results: ${err.slice(0, 1000)}`));
      }
    });
  });
}
