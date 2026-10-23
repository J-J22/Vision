// Model relay for the crossexam council. crossexam speaks the OpenAI chat format; this forwards each seat's
// call to Groq through Vision's wrapper, so seats get rate-limit pacing and retries, and the Groq key never
// leaves this server. Only crossexam processes started by Vision know the token.
import { NextResponse } from "next/server";
import { callText, type Message } from "@/lib/llm";
import { relayToken } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${relayToken}`) {
    return NextResponse.json({ error: { message: "Not allowed" } }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.model || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: { message: "model and messages are required" } }, { status: 400 });
  }
  const messages = body.messages as Message[];
  const prompt = messages.map((m) => m.content).join("\n");
  // Seat turns must answer in crossexam's JSON format; the synthesis is Markdown
  const isSynthesis = prompt.includes("designated synthesizer");
  try {
    const content = await callText({
      label: isSynthesis ? "council synthesis" : "council seat",
      model: body.model,
      messages,
      json: !isSynthesis,
      maxTokens: isSynthesis ? 1800 : 900,
    });
    return NextResponse.json({ choices: [{ message: { role: "assistant", content } }] });
  } catch (err) {
    console.warn(`[council relay] ${body.model}: ${err instanceof Error ? err.message : err}`);
    return NextResponse.json({ error: { message: String(err instanceof Error ? err.message : err) } }, { status: 502 });
  }
}
