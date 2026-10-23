// Edge-case tests for any generated app. The QA agent writes them from the app's API contract (lib/agents/qa.ts) as JSON;
// this runner executes them, plus smoke tests every app must pass (pages load, login works, no server errors).
// Usage: node tests/edge-cases/run.mjs <app url> <tests.json> <public dir>
// Test format: { name, area, steps: [{ as: "anon"|"alice"|"bob", method, path, body?, expect: [statuses], save?: { var: "json.path" } }] }
// "{{var}}" in a path or body string is replaced by a saved value; "{{run}}" by a value unique to this run;
// "{{long:N}}" by N characters.
// Prints one JSON array: [{ name, area, passed, detail }]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const [base = "http://localhost:4000", testsFile, publicDir, mode] = process.argv.slice(2);
const apiOnly = mode === "api"; // skip the (slow) browser checks
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

// ---------- rendering pages in a simulated browser ----------
// Catches pages that crash in the browser (white screens), which API tests can't see.

const srcPages = publicDir ? join(publicDir, "..", "src", "pages") : "";
const reactPages = !apiOnly && srcPages && existsSync(srcPages)
  ? readdirSync(srcPages)
      .filter((f) => f.endsWith(".jsx"))
      .map((file) => {
        const code = readFileSync(join(srcPages, file), "utf8");
        return { file, route: code.match(/export const route\s*=\s*["'`]([^"'`]+)/)?.[1], auth: /export const auth\s*=\s*true/.test(code) };
      })
      .filter((p) => p.route && p.route !== "*")
  : [];

async function renderPage(path, login) {
  const html = await (await fetch(base + path)).text();
  const bundle = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  if (!bundle) throw new Error("The page has no app script (the frontend didn't build)");
  const js = await (await fetch(base + bundle)).text();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.detail?.message ?? e.message));
  vc.on("error", (...args) => {
    const text = args.map(String).join(" ");
    if (!text.startsWith("Warning:")) errors.push(text.slice(0, 300));
  });
  const dom = new JSDOM(html.replace(/<script[^>]*src=[^>]*><\/script>/g, ""), {
    url: base + path,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      // Behave like a current browser: scrollTo and friends return Promises, layout APIs exist
      w.scrollTo = () => Promise.resolve();
      w.Element.prototype.scrollIntoView = () => Promise.resolve();
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.fetch = (u, o) => fetch(new URL(String(u), base), o);
      if (login) {
        w.localStorage.setItem("token", login.token);
        w.localStorage.setItem("user", JSON.stringify(login.user));
      }
    },
  });
  const script = dom.window.document.createElement("script");
  script.textContent = js;
  dom.window.document.body.append(script);
  await new Promise((r) => setTimeout(r, 1500));
  const root = dom.window.document.getElementById("root");
  const text = (root?.textContent ?? "").replace(/\s+/g, " ").trim();
  // Leave the page like a visitor would: route changes run every effect's cleanup, where crashes like
  // "effect returned a Promise" only show up
  dom.window.history.pushState({}, "", "/__vision-leave");
  dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
  await new Promise((r) => setTimeout(r, 400));
  dom.window.close();
  if (errors.length) throw new Error(`${path} crashed in the browser: ${errors.slice(0, 3).join(" | ")}`);
  if (text.includes("Something went wrong on this page")) throw new Error(`${path} shows an error instead of the page: ${text.slice(0, 300)}`);
  if (text.length < 20) throw new Error(`${path} renders a blank page`);
}

const generated = testsFile ? JSON.parse(readFileSync(testsFile, "utf8")) : [];
const pages = publicDir ? readdirSync(publicDir).filter((f) => f.endsWith(".html")) : [];

const tests = [
  ...generated.map((t) => ({ name: t.name, area: t.area ?? "api", run: () => runSteps(t.steps ?? []) })),
  ...reactPages.map((p) => ({
    name: `Page works in the browser: ${p.route}`,
    area: "pages",
    file: p.file,
    run: async () => {
      let login;
      if (p.auth) {
        const r = await call("POST", "/api/auth/register", { body: { email: `page-${runId}-${p.file}@test.dev`.toLowerCase(), password: "secret123", name: "Page Tester" } });
        login = r.data;
      }
      // Pages with :params get an id that may not exist; they must still show something sensible
      await renderPage(p.route.replace(/:[^/]+/g, "1"), login);
    },
  })),
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
    results.push({ name: t.name, area: t.area, passed: false, detail: String(err.message ?? err), ...(t.file ? { file: `web/src/pages/${t.file}` } : {}) });
  }
}
// Runs last so it covers every request above
results.push(
  serverErrors.length
    ? { name: "No request crashes the server", area: "api", passed: false, detail: serverErrors.slice(0, 5).join("\n") }
    : { name: "No request crashes the server", area: "api", passed: true },
);
console.log(JSON.stringify(results));
