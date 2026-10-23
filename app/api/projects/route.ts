// Creates a project and returns its id
import { NextResponse } from "next/server";
import { createProject, view } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // The council's model relay is called back on this same server
  const origin = new URL(req.url).origin;
  return NextResponse.json(view(createProject(origin)));
}
