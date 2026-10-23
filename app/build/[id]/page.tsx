"use client";
// Build screen: task board, agent feed, test results and the preview link, all from the event stream.
// /build/sample starts a build of lib/sample-blueprint.json.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildEvent, Task } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import type { ProjectView } from "@/components/useProject";

const COLUMNS: { status: Task["status"]; label: string }[] = [
  { status: "waiting", label: "Waiting" },
  { status: "running", label: "Working" },
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
];

// Which logo each build agent uses in the team chat
const AGENT_LOOK: Record<string, string> = { planner: "product", backend: "architect", frontend: "designer", qa: "skeptic", reviewer: "security", system: "moderator" };

const STATUS_LABEL: Record<string, string> = {
  planning: "The project manager is planning the work…",
  building: "Agents are writing code…",
  testing: "QA is running the edge-case tests…",
  fixing: "Fixing what the tests found…",
  done: "Build finished",
  failed: "Build stopped",
};

export default function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [messages, setMessages] = useState<{ agent: string; text: string }[]>([]);
  const [tests, setTests] = useState<Record<string, { passed: boolean; detail?: string }>>({});
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState<{ status: string; detail?: string }>({ status: "planning" });
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectView | null>(null);

  // Builds started from a project show inside that project's frame (/build/<id>?project=<projectId>)
  useEffect(() => {
    const projectId = new URLSearchParams(window.location.search).get("project");
    if (!projectId) return;
    fetch(`/api/projects/${projectId}`).then((r) => r.json()).then((d) => !d.error && setProject(d)).catch(() => {});
  }, []);

  // /build/sample: start a sample build, then move to its real URL
  useEffect(() => {
    if (id !== "sample") return;
    fetch("/api/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then((r) => r.json())
      .then((d) => (d.buildId ? router.replace(`/build/${d.buildId}`) : setError(d.error ?? "Couldn't start")))
      .catch((e) => setError(String(e)));
  }, [id, router]);

  useEffect(() => {
    if (id === "sample") return;
    const source = new EventSource(`/api/build/${id}/events`);
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as BuildEvent;
      if (e.type === "task") setTasks((t) => ({ ...t, [e.task.id]: e.task }));
      else if (e.type === "message") setMessages((m) => [...m, { agent: e.agent, text: e.text }]);
      else if (e.type === "test") setTests((t) => ({ ...t, [e.name]: { passed: e.passed, detail: e.detail } }));
      else if (e.type === "preview") setPreview(e.url);
      else if (e.type === "status") {
        setStatus({ status: e.status, detail: e.detail });
        // New test run: clear old results
        if (e.status === "testing") setTests({});
      }
    };
    source.onerror = () => setError("Lost connection to the build. Refresh to reconnect.");
    source.onopen = () => {
      // The stream replays the whole build on every (re)connect, so start from empty
      setError("");
      setTasks({});
      setMessages([]);
      setTests({});
    };
    return () => source.close();
  }, [id]);

  const list = Object.values(tasks);
  const testList = Object.entries(tests);
  const passed = testList.filter(([, t]) => t.passed).length;

  return (
    <Shell project={project} page="build">
      <div className="row">
        <h1>Build {id === "sample" ? "" : id}</h1>
        <span className={`chip ${status.status === "done" ? "good" : status.status === "failed" ? "bad" : "warn"}`}>{STATUS_LABEL[status.status] ?? status.status}</span>
        {status.detail && <span className="muted small">{status.detail}</span>}
        {(preview || status.status === "done") && (
          <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
            {preview && (
              <a className="btn" href={preview} target="_blank" rel="noreferrer">
                Open the app
              </a>
            )}
            {status.status === "done" && id !== "sample" && (
              <a className="btn ghost" href={`/api/build/${id}/download`} download>
                Download code (.zip)
              </a>
            )}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <section className="board">
        {COLUMNS.map((c) => (
          <div className="col" key={c.status}>
            <h3>{c.label} · {list.filter((t) => t.status === c.status).length}</h3>
            {list.filter((t) => t.status === c.status).map((t) => (
              <div key={t.id} className={`task ${t.status}`}>
                <div className="meta"><span>{t.id}</span><span>{t.agent}</span></div>
                <span>{t.title}</span>
                {t.files.length > 0 && <span className="mono muted">{t.files.join(", ")}</span>}
                {t.status === "waiting" && t.dependsOn.length > 0 && <span className="muted small">waits for {t.dependsOn.join(", ")}</span>}
              </div>
            ))}
          </div>
        ))}
      </section>

      <div className="two">
        <section className="card">
          <h2>Team chat</h2>
          <div className="feed">
            {messages.length === 0 && <p className="muted">Agents post here as they finish their work.</p>}
            {messages.map((m, i) => (
              <div key={i} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                <Avatar who={AGENT_LOOK[m.agent] ?? "moderator"} size="sm" />
                <div className="bubble"><span className="label neon">{m.agent}</span><p>{m.text}</p></div>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Edge-case tests {testList.length > 0 && <span className="muted small">· {passed} of {testList.length} pass</span>}</h2>
          <div className="tests">
            {testList.length === 0 && <p className="muted">Tests run when the code is written.</p>}
            {testList.map(([name, t]) => (
              <div key={name} className="t">
                <span className={`chip ${t.passed ? "good" : "bad"}`}>{t.passed ? "pass" : "fail"}</span>
                <span>{name}</span>
                {!t.passed && t.detail && <span className="detail">{t.detail}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
