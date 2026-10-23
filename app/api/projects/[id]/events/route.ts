// Server-Sent Events: sends the whole project every time it changes
import { getProject, subscribe, view } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const p = getProject(id);
  if (!p) return new Response("Project not found", { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(view(getProject(id)!))}\n\n`));
        } catch {}
      };
      send();
      unsubscribe = subscribe(id, send);
      ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch {}
      }, 15000);
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(ping);
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      unsubscribe();
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
