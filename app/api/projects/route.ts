// Creates a project and returns its id. Body { idea } (optional) starts the interview from the user's idea.
import { NextResponse } from "next/server";
import { createProject, view } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // The council's model relay is called back on this same server
  const origin = new URL(req.url).origin;
  const body = await req.json().catch(() => ({}));
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  return NextResponse.json(view(createProject(origin, idea)));
}
