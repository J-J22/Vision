// Edge-case tests for any generated app. The QA agent writes them from the app's API contract (lib/agents/qa.ts) as JSON;
// this runner executes them, plus smoke tests every app must pass (pages load, login works, no server errors).
// Usage: node tests/edge-cases/run.mjs <app url> <tests.json> <public dir>
// Test format: { name, area, steps: [{ as: "anon"|"alice"|"bob", method, path, body?, expect: [statuses], save?: { var: "json.path" } }] }
// "{{var}}" in a path or body string is replaced by a saved value; "{{run}}" by a value unique to this run;
// "{{long:N}}" by N characters.
// Prints one JSON array: [{ name, area, passed, detail }]
import { readdirSync, readFileSync } from "node:fs";

const [base = "http://localhost:4000", testsFile, publicDir] = process.argv.slice(2);
const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const serverErrors = [];

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (res.status >= 500) serverErrors.push(`${method} ${path} -> ${res.status} ${text.slice(0, 150)}`);
  return { status: res.status, data, text };
}

const tokens = {};
async function tokenFor(who) {
  if (!who || who === "anon") return undefined;
  if (tokens[who]) return tokens[who];
  const r = await call("POST", "/api/auth/register", { body: { email: `${who}-${runId}@test.dev`, password: "secret123", name: who[0].toUpperCase() + who.slice(1) } });
  if (r.status !== 201 || !r.data?.token) throw new Error(`Setup failed: registering ${who} returned ${r.status}`);
  return (tokens[who] = r.data.token);
}

const pick = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

function fill(value, vars) {
  if (typeof value === "string") {
    // "{{long:5001}}" becomes 5001 characters: models can't type out long strings themselves
    value = value.replace(/\{\{long:(\d{1,6})\}\}/g, (m, n) => "a".repeat(Number(n)));
    const whole = value.match(/^\{\{(\w+)\}\}$/);
    if (whole && whole[1] in vars) return vars[whole[1]]; // keep numbers as numbers
    return value.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

async function runSteps(steps) {
  const vars = { run: runId };
  for (const [i, step] of steps.entries()) {
    const path = fill(step.path, vars);
    if (/\{\{\w+\}\}/.test(path)) throw new Error(`Step ${i + 1}: ${path} uses a value an earlier step didn't save`);
    const r = await call(step.method, path, { token: await tokenFor(step.as), body: fill(step.body, vars) });
    const expect = [].concat(step.expect ?? 200);
    if (!expect.includes(r.status)) {
      throw new Error(`${step.as ?? "anon"} ${step.method} ${path}: expected ${expect.join(" or ")}, got ${r.status} ${(r.text || "").slice(0, 200)}`);
    }
    for (const [name, at] of Object.entries(step.save ?? {})) {
      const v = pick(r.data, at);
      if (v === undefined) throw new Error(`${step.method} ${path}: the response had no "${at}" (${(r.text || "").slice(0, 200)})`);
      vars[name] = v;
    }
  }
}

const generated = testsFile ? JSON.parse(readFileSync(testsFile, "utf8")) : [];
const pages = publicDir ? readdirSync(publicDir).filter((f) => f.endsWith(".html")) : [];

const tests = [
  ...generated.map((t) => ({ name: t.name, area: t.area ?? "api", run: () => runSteps(t.steps ?? []) })),
  {
    name: "Every page loads",
    area: "pages",
    run: async () => {
      const broken = [];
      for (const p of pages) {
        const r = await call("GET", "/" + p.replace(/\.html$/, "").replace(/^index$/, ""));
        if (r.status !== 200) broken.push(`${p} (${r.status})`);
      }
      if (broken.length) throw new Error(`These pages don't load: ${broken.join(", ")}`);
    },
  },
  {
    name: "Sign-up and login work",
    area: "auth",
    run: async () => {
      const r = await call("GET", "/api/auth/me", { token: await tokenFor("carol") });
      if (r.status !== 200) throw new Error(`/api/auth/me returned ${r.status} for a new user`);
    },
  },
  {
    name: "Unknown API paths return a clear 404",
    area: "api",
    run: async () => {
      const r = await call("GET", `/api/nothing-here-${runId}`);
      if (r.status !== 404 || !r.data?.error) throw new Error(`Expected a JSON 404, got ${r.status}`);
    },
  },
];

const results = [];
for (const t of tests) {
  try {
    await t.run();
    results.push({ name: t.name, area: t.area, passed: true });
  } catch (err) {
    results.push({ name: t.name, area: t.area, passed: false, detail: String(err.message ?? err) });
  }
}
// Runs last so it covers every request above
results.push(
  serverErrors.length
    ? { name: "No request crashes the server", area: "api", passed: false, detail: serverErrors.slice(0, 5).join("\n") }
    : { name: "No request crashes the server", area: "api", passed: true },
);
console.log(JSON.stringify(results));
