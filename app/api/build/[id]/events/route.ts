// Server-Sent Events: replays everything that happened in the build so far, then streams new events.
import { getBuild } from "@/lib/runner";
import type { BuildEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const build = getBuild(id);
  if (!build) return new Response("Build not found", { status: 404 });

  const encoder = new TextEncoder();
  let listener: ((e: BuildEvent) => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: BuildEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      build.events.forEach(send);
      listener = send;
      build.listeners.add(send);
      ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15000);
      req.signal.addEventListener("abort", () => {
        build.listeners.delete(send);
        clearInterval(ping);
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      if (listener) build.listeners.delete(listener);
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
