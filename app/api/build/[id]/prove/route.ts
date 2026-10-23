// Re-run the planted-bug proof on a build that's on disk (also builds made before the proof step existed).
// POST -> { bugs: [{ what, file, caught, by }], caught, total, url }
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { provePlantedBugs } from "@/lib/proof";
import { workspacePath } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9]{8}$/.test(id) || !existsSync(join(workspacePath(id), "server.js"))) {
    return NextResponse.json({ error: "Unknown build" }, { status: 404 });
  }
  const testsFile = join(workspacePath(id), ".vision-tests.json");
  const tests = existsSync(testsFile) ? JSON.parse(readFileSync(testsFile, "utf8")) : [];
  const { bugs, url } = await provePlantedBugs(id, tests, () => {});
  return NextResponse.json({ bugs, caught: bugs.filter((b) => b.caught).length, total: bugs.length, url });
}
