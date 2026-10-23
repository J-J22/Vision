// GET: the project as the pages see it. POST { action, payload }: answer, skip-questions, retry, update-master, approve.
import { NextResponse } from "next/server";
import { act, getProject, view } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = getProject((await params).id);
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(view(p));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = getProject((await params).id);
  if (!p) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const { action, payload } = await req.json().catch(() => ({}));
  try {
    p.origin = new URL(req.url).origin;
    act(p, String(action), payload ?? {});
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
  return NextResponse.json(view(p));
}
