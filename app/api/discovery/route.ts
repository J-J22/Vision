// One endpoint for every Discovery step. Body: { sessionId?, action, payload }
import { NextResponse } from "next/server";
import { createSession, finishNow, getSession, submitAnswers, submitIdea, submitProfile, view } from "@/lib/discovery-session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { sessionId, action, payload } = await req.json().catch(() => ({}));

  if (action === "start") return NextResponse.json(view(createSession()));

  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return NextResponse.json({ error: "Session not found. Start again." }, { status: 404 });

  try {
    if (action === "profile") await submitProfile(session, payload?.answers ?? {});
    else if (action === "idea") {
      const idea = String(payload?.idea ?? "").trim();
      if (idea.length < 10) return NextResponse.json({ error: "Describe your idea in at least a sentence." }, { status: 400 });
      await submitIdea(session, idea);
    } else if (action === "answers") await submitAnswers(session, payload?.answers ?? {});
    else if (action === "finish") finishNow(session);
    else if (action !== "get") return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[discovery]", err);
    return NextResponse.json({ ...view(session), error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
  return NextResponse.json(view(session));
}
