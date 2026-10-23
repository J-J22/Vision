// Checks that this PC can run Vision and says how to fix anything that's wrong.
// `npm run doctor` runs every check; `--quick` (used before `npm run dev`) skips the network checks.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const quick = process.argv.includes("--quick");
let failed = 0;

function report(ok, label, fix) {
  console.log(`${ok ? "OK  " : "FIX "} ${label}${ok || !fix ? "" : `\n     → ${fix}`}`);
  if (!ok) failed++;
}

// Node 22.13+ has the built-in SQLite the generated apps use, without extra flags
const [major, minor] = process.versions.node.split(".").map(Number);
const nodeOk = major > 22 || (major === 22 && minor >= 13);
report(nodeOk, `Node ${process.versions.node} (need 22.13 or newer)`, "Install the current LTS from https://nodejs.org, then reopen the terminal");

if (nodeOk) {
  let sqliteOk = true;
  try {
    execFileSync(process.execPath, ["-e", "require('node:sqlite')"], { stdio: "ignore" });
  } catch {
    sqliteOk = false;
  }
  report(sqliteOk, "Built-in SQLite (node:sqlite)", "Update Node to the current LTS from https://nodejs.org");
}

report(existsSync("node_modules/next"), "Vision packages installed", "Run: npm run setup");
report(existsSync("templates/marketplace/node_modules/express"), "Marketplace template packages installed", "Run: npm run setup");

// .env.local: same parsing rules as Next.js for the simple cases (quotes allowed)
const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const key = process.env.GROQ_API_KEY || env.GROQ_API_KEY || "";
const fake = (process.env.VISION_FAKE_AGENTS || env.VISION_FAKE_AGENTS) === "1";
report(existsSync(".env.local"), ".env.local exists", "Copy .env.example to .env.local (Windows: copy .env.example .env.local)");
report(Boolean(key) || fake, "Groq key set", "Put GROQ_API_KEY=your-key in .env.local (get one at https://console.groq.com/keys), or set VISION_FAKE_AGENTS=1 to try the build without a key");

if (!quick && key) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    report(res.ok, `Groq accepts the key (HTTP ${res.status})`, res.status === 401 ? "The key is wrong or was deleted. Make a new one at https://console.groq.com/keys" : "Groq returned an error; try again in a minute");
    if (res.ok) {
      const ids = new Set((await res.json()).data.map((m) => m.id));
      const wanted = [
        env.GROQ_MODEL_BIG || "openai/gpt-oss-120b",
        env.GROQ_MODEL_SMALL || "openai/gpt-oss-20b",
        ...(env.GROQ_PARLIAMENT_MODELS || "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b,qwen/qwen3.8-27b").split(",").map((s) => s.trim()),
      ];
      const missing = [...new Set(wanted)].filter((m) => !ids.has(m));
      report(!missing.length, "Configured models exist on this Groq account", `Not available: ${missing.join(", ")}. Run npm run models and update .env.local`);
    }
  } catch (err) {
    report(false, "Can reach api.groq.com", `Network problem (${err.cause?.code ?? err.name}). Try another Wi-Fi or a phone hotspot; some campus networks block it`);
  }
}

if (!quick) {
  let py = "";
  for (const cmd of ["python3", "python", "py"]) {
    try {
      py = execFileSync(cmd, ["--version"], { encoding: "utf8" }).trim();
      break;
    } catch {}
  }
  const m = py.match(/(\d+)\.(\d+)/);
  report(Boolean(m) && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 9)), `Python ${py || "not found"} (need 3.9+ for the debate panel)`, "Install Python 3 from https://www.python.org/downloads (Windows: tick \"Add python.exe to PATH\")");
}

console.log(failed ? `\n${failed} thing${failed === 1 ? "" : "s"} to fix.` : "\nAll good. Run: npm run dev");
if (quick && failed) process.exit(1);
