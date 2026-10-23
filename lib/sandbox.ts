// Each build gets its own copy of the marketplace template in workspaces/<id>/.
// The generated app runs as a separate Node process on its own port.
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, posix, relative, resolve } from "node:path";
import type { TestResult } from "./types";

const ROOT = process.cwd();
const TEMPLATE = join(ROOT, "templates", "marketplace");
const WORKSPACES = join(ROOT, "workspaces");
const TESTS = join(ROOT, "tests", "edge-cases", "run.mjs");

// Folders agents may write to, and files inside them they must not touch
const WRITABLE = ["db/", "routes/", "public/"];
const PROTECTED = new Set([
  "db/001_core.sql",
  "routes/000_health.js",
  "routes/001_auth.js",
  "public/app.js",
  "public/style.css",
  "public/login.html",
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
  if (!WRITABLE.some((w) => clean.startsWith(w))) return { ok: false, error: `${path}: agents may only write to ${WRITABLE.join(", ")}` };
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

// All files agents can see, as { path: content }, skipping the starter internals
export function readWorkspace(id: string, folders = WRITABLE): Record<string, string> {
  const dir = workspacePath(id);
  const out: Record<string, string> = {};
  for (const folder of folders) {
    const full = join(dir, folder);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      const rel = `${folder}${name}`;
      out[rel] = readFileSync(join(full, name), "utf8");
    }
  }
  return out;
}

export function conventions(): string {
  return readFileSync(join(TEMPLATE, "CONVENTIONS.md"), "utf8");
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

export async function runTests(url: string): Promise<TestResult[]> {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, [TESTS, url], { stdio: ["ignore", "pipe", "pipe"] });
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
