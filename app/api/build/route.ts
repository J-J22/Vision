// Starts a build from a Blueprint. Projects start builds through their "approve" action; this route is for
// testing: POST {} builds lib/sample-blueprint.json, or send { blueprint, minutes, masterPrompt }.
import { NextResponse } from "next/server";
import { startBuild } from "@/lib/runner";
import { BlueprintSchema } from "@/lib/types";
import sample from "@/lib/sample-blueprint.json";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = BlueprintSchema.safeParse(body.blueprint ?? sample);
  if (!parsed.success) return NextResponse.json({ error: "Invalid blueprint", issues: parsed.error.issues }, { status: 400 });
  const build = startBuild(parsed.data, body.minutes, typeof body.masterPrompt === "string" ? body.masterPrompt : undefined);
  return NextResponse.json({ buildId: build.id });
}
