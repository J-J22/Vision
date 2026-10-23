// Proves the edge-case tests are correct: runs them against the hand-written reference API.
import { cpSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const template = resolve("templates/marketplace");
const dir = mkdtempSync(join(tmpdir(), "vision-ref-"));
cpSync(template, dir, {
  recursive: true,
  filter: (src) => !relative(template, src).startsWith("node_modules") && !src.includes("data.sqlite"),
});
symlinkSync(join(template, "node_modules"), join(dir, "node_modules"), "junction");
cpSync(resolve("tests/reference"), dir, { recursive: true });

const port = 4999;
const app = spawn(process.execPath, ["server.js"], { cwd: dir, env: { ...process.env, PORT: String(port), RESET_DB: "1" }, stdio: "inherit" });
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const out = execFileSync(process.execPath, ["tests/edge-cases/run.mjs", `http://localhost:${port}`], { encoding: "utf8" });
  const results = JSON.parse(out);
  for (const r of results) console.log(`${r.passed ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  const failed = results.filter((r) => !r.passed).length;
  console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
} finally {
  app.kill();
  rmSync(dir, { recursive: true, force: true });
}
