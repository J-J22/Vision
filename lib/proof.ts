// Proof that the tests work: plant typical bugs in the finished app one at a time, run the tests, and count
// how many the tests catch (mutation testing). No AI involved. The real code is always put back.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildFrontend, runTests, startApp, workspacePath } from "./sandbox";

export type PlantedBug = { what: string; file: string; caught: boolean; by?: string };

type Mutation = { what: string; file: string; from: string; to: string; frontend?: boolean };

// Each kind changes the behaviour of one whole route file (a global regex replaces every match in it)
const KINDS: { what: string; find: RegExp; replace: string }[] = [
  // Only inside route definitions such as app.post("/api/x", requireAuth, …), not the import of requireAuth
  { what: "Removed the login checks, so anyone could use members-only actions", find: /(app\.(?:post|put|patch|delete)\(\s*["'`][^"'`]+["'`]\s*,\s*)requireAuth\s*,\s*/g, replace: "$1" },
  { what: "Let people change or delete someone else's data", find: /\.status\(403\)/g, replace: ".status(200)" },
  { what: "Accepted invalid input instead of rejecting it", find: /\.status\(400\)/g, replace: ".status(200)" },
  { what: "Pretended missing items exist", find: /\.status\(404\)/g, replace: ".status(200)" },
  { what: "Allowed duplicates and double actions", find: /\.status\(409\)/g, replace: ".status(200)" },
];

function mutations(id: string): Mutation[] {
  const dir = workspacePath(id);
  const routes = readdirSync(join(dir, "routes"))
    .filter((f) => f.endsWith(".js") && !f.startsWith("00"))
    .sort();
  const out: Mutation[] = [];
  for (const kind of KINDS) {
    for (const f of routes) {
      const file = `routes/${f}`;
      const code = readFileSync(join(dir, file), "utf8");
      const mutated = code.replace(kind.find, kind.replace);
      if (mutated !== code) {
        out.push({ what: kind.what, file, from: code, to: mutated });
        break;
      }
    }
  }
  // The white-screen bug from the first React build: an effect that returns a Promise crashes pages on leave
  const shell = "web/src/App.jsx";
  if (existsSync(join(dir, shell))) {
    const code = readFileSync(join(dir, shell), "utf8");
    const fixed = /useEffect\(\(\) => \{\s*window\.scrollTo\(0, 0\);\s*\}, \[location\.pathname\]\);/;
    if (fixed.test(code)) {
      out.push({ what: "Made pages crash when you leave them (a white screen)", file: shell, from: code, to: code.replace(fixed, "useEffect(() => window.scrollTo(0, 0), [location.pathname]);"), frontend: true });
    }
  }
  return out;
}

// Runs every planted bug; leaves the original app built and running. Returns the bugs and the app's new URL.
export async function provePlantedBugs(id: string, tests: unknown[], onProgress: (bug: PlantedBug) => void): Promise<{ bugs: PlantedBug[]; url?: string }> {
  const dir = workspacePath(id);
  const bugs: PlantedBug[] = [];
  for (const m of mutations(id)) {
    const path = join(dir, m.file);
    try {
      writeFileSync(path, m.to);
      if (m.frontend && !(await buildFrontend(id)).ok) continue;
      const { url } = await startApp(id);
      const results = await runTests(id, url, tests, m.frontend ? "all" : "api");
      const failed = results.filter((r) => !r.passed);
      const bug: PlantedBug = { what: m.what, file: m.file, caught: failed.length > 0, by: failed[0]?.name };
      bugs.push(bug);
      onProgress(bug);
    } catch {
      // The planted change broke the app outright: that says nothing about the tests, so it isn't counted
    } finally {
      writeFileSync(path, m.from);
    }
  }
  if (bugs.some((b) => b.file.startsWith("web/"))) await buildFrontend(id);
  const { url } = await startApp(id).catch(() => ({ url: undefined }));
  return { bugs, url };
}
