// Download a built app as a .zip: the code the agents wrote plus the starter, ready for `npm install && npm start`.
// Works for any build still on disk (workspaces/<id>), also after Vision restarts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getBuild } from "@/lib/runner";
import { workspacePath } from "@/lib/sandbox";
import { zip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

// Vision's own working files, not part of the app
const SKIP = /^(node_modules|data\.sqlite.*|\.vision-tests\.json|CONVENTIONS\.md)$/;

function collect(root: string, dir = root, out: { rel: string; full: string }[] = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.test(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(root, full, out);
    else out.push({ rel: relative(root, full).split("\\").join("/"), full });
  }
  return out;
}

// The app's name: from the build if Vision still has it in memory, else from the project that started it
function appName(id: string): string {
  const name = getBuild(id)?.blueprint.app.name;
  if (name) return name;
  const projects = join(process.cwd(), "data", "projects");
  for (const f of existsSync(projects) ? readdirSync(projects) : []) {
    try {
      const p = JSON.parse(readFileSync(join(projects, f), "utf8"));
      if (p.buildId === id && p.blueprint?.app?.name) return p.blueprint.app.name;
    } catch {}
  }
  return "app";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{8}$/.test(id)) return new Response("Unknown build", { status: 404 });
  const dir = workspacePath(id);
  if (!existsSync(join(dir, "server.js"))) return new Response("This build isn't on disk anymore", { status: 404 });

  const name = appName(id);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
  const entries: ZipEntry[] = collect(dir).map(({ rel, full }) => {
    let data = readFileSync(full);
    if (rel === "package.json") {
      const pkg = JSON.parse(data.toString("utf8"));
      data = Buffer.from(JSON.stringify({ ...pkg, name: slug }, null, 2) + "\n");
    }
    return { path: `${slug}/${rel}`, data };
  });

  const tests = join(dir, ".vision-tests.json");
  const testCount = existsSync(tests) ? JSON.parse(readFileSync(tests, "utf8")).length : 0;
  entries.push({
    path: `${slug}/README.md`,
    data: Buffer.from(`# ${name}

Built by Vision's AI team: planned with you, reviewed by the council, coded by the agents${testCount ? `, and checked against ${testCount} edge-case tests` : ""}.

## Run it

Needs Node.js 22.13 or newer.

\`\`\`
npm install
npm start
\`\`\`

Then open http://localhost:4000 (set \`PORT\` to use another port).

## What's inside

- \`public/\`: the pages, \`theme.css\` (the look) and \`site.js\` (name and navigation)
- \`routes/\`: the API, one file per area
- \`db/\`: the database tables (SQLite, created on first start in \`data.sqlite\`)
- \`server.js\`, \`lib/\`: the server, database and login
`),
  });

  return new Response(new Uint8Array(zip(entries)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
