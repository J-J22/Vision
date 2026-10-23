// Lists the models your Groq key can use: `npm run models`
import { readFileSync, existsSync } from "node:fs";

if (!process.env.GROQ_API_KEY && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY is not set (put it in .env.local)");
  process.exit(1);
}

const res = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
});
if (!res.ok) {
  console.error(`Groq returned ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const { data } = await res.json();
for (const m of data.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`${m.id.padEnd(50)} context ${m.context_window ?? "?"}`);
}
