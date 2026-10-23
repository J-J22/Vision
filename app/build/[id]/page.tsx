"use client";
// Build screen: pipeline, live preview, task lanes, test scorecard and team feed, all from the event stream.
// /build/sample starts a build of lib/sample-blueprint.json.
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildEvent, Task } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { Avatar } from "@/components/Avatar";
import type { ProjectView } from "@/components/useProject";
import s from "./build.module.css";

// Which logo each build agent uses in the team chat
const AGENT_LOOK: Record<string, string> = { planner: "product", backend: "architect", frontend: "designer", qa: "skeptic", reviewer: "security", system: "moderator" };

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning the work",
  building: "Agents are writing code",
  testing: "Running the edge-case tests",
  fixing: "Fixing what the tests found",
  done: "Build finished",
  failed: "Build stopped",
};

const STEPS = [
  { key: "plan", label: "Plan", icon: "account_tree" },
  { key: "tests", label: "Write tests", icon: "checklist" },
  { key: "build", label: "Build", icon: "code" },
  { key: "test", label: "Test", icon: "science" },
  { key: "fix", label: "Fix", icon: "build" },
  { key: "done", label: "Done", icon: "rocket_launch" },
];

const LANES: { agent: Task["agent"]; label: string }[] = [
  { agent: "backend", label: "Backend" },
  { agent: "frontend", label: "Frontend" },
  { agent: "qa", label: "QA" },
];

const TASK_ICON: Record<Task["status"], string> = { waiting: "schedule", running: "progress_activity", done: "check_circle", failed: "error" };

function stepIndex(status: string, planned: boolean, wroteTests: boolean) {
  if (status === "planning") return wroteTests ? 2 : planned ? 1 : 0;
  return { building: 2, testing: 3, fixing: 4, done: 5 }[status] ?? -1;
}

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
  const [runs, setRuns] = useState(0);
  const [visited, setVisited] = useState<number[]>([]);
  const [lastStep, setLastStep] = useState(0);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [reload, setReload] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);

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
        if (e.status === "testing") {
          setTests({});
          setRuns((r) => r + 1);
        }
        if (e.status === "fixing") setVisited((v) => (v.includes(4) ? v : [...v, 4]));
      }
    };
    source.onerror = () => setError("Lost connection to the build. Refresh to reconnect.");
    source.onopen = () => {
      // The stream replays the whole build on every (re)connect, so start from empty
      setError("");
      setTasks({});
      setMessages([]);
      setTests({});
      setRuns(0);
      setVisited([]);
    };
    return () => source.close();
  }, [id]);

  // Keep the feed pinned to the newest message
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const list = Object.values(tasks);
  const testList = Object.entries(tests);
  const passed = testList.filter(([, t]) => t.passed).length;
  const done = status.status === "done";
  const failed = status.status === "failed";
  const planned = messages.some((m) => m.agent === "planner");
  const wroteTests = messages.some((m) => m.agent === "qa");
  const idx = stepIndex(status.status, planned, wroteTests);
  const current = failed ? lastStep : idx;
  useEffect(() => {
    if (idx >= 0) setLastStep(idx);
  }, [idx]);
  const tasksDone = list.filter((t) => t.status === "done").length;
  const files = new Set(list.flatMap((t) => t.files)).size;
  const fixes = list.filter((t) => t.id.startsWith("FIX")).length;

  function stepState(i: number) {
    if (failed && i === current) return "failed";
    if (done) return i === 4 && !visited.includes(4) ? "skipped" : "done";
    if (i === current) return "current";
    if (i < current || visited.includes(i)) return "done";
    return "todo";
  }

  const tone = done ? s.good : failed ? s.bad : s.live;
  const pct = testList.length ? passed / testList.length : 0;
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <Shell project={project} page="build">
      <div className={s.page}>
        <header className={s.head}>
          <div className={s.headMain}>
            <span className="label">Build {id === "sample" ? "" : id}</span>
            <div className={s.statusLine}>
              <span className={`${s.dot} ${tone}`} />
              <h2 className={s.statusText}>{STATUS_LABEL[status.status] ?? status.status}</h2>
            </div>
            <div className={s.facts}>
              {status.detail && <span>{status.detail}</span>}
              {list.length > 0 && <span>{tasksDone}/{list.length} tasks</span>}
              {files > 0 && <span>{files} files</span>}
              {runs > 0 && <span>{runs} test run{runs > 1 ? "s" : ""}</span>}
              {fixes > 0 && <span>{fixes} fix{fixes > 1 ? "es" : ""}</span>}
            </div>
          </div>
          {(preview || done) && (
            <div className={s.actions}>
              {preview && (
                <a className="btn" href={preview} target="_blank" rel="noreferrer">
                  Open the app
                </a>
              )}
              {done && id !== "sample" && (
                <a className="btn ghost" href={`/api/build/${id}/download`} download>
                  Download code (.zip)
                </a>
              )}
            </div>
          )}
        </header>
        {error && <p className="error">{error}</p>}

        <ol className={s.steps}>
          {STEPS.map((step, i) => {
            const st = stepState(i);
            return (
              <li key={step.key} className={`${s.step} ${s[st] ?? ""}`}>
                <span className={s.stepIcon}>
                  <span className="icon" aria-hidden="true">
                    {st === "done" ? "check" : st === "failed" ? "close" : st === "skipped" ? "remove" : step.icon}
                  </span>
                </span>
                <span className={s.stepLabel}>{step.label}</span>
              </li>
            );
          })}
        </ol>

        <div className={s.grid}>
          <div className={s.mainCol}>
            {preview && (
              <section className={s.browser}>
                <div className={s.chrome}>
                  <span className={s.lights}><i /><i /><i /></span>
                  <span className={s.address}>
                    <span className="icon" aria-hidden="true">lock</span>
                    <span className={s.url}>{preview}</span>
                  </span>
                  <div className={s.seg}>
                    <button className={device === "desktop" ? s.on : ""} onClick={() => setDevice("desktop")} title="Desktop width" aria-label="Desktop width">
                      <span className="icon">desktop_windows</span>
                    </button>
                    <button className={device === "phone" ? s.on : ""} onClick={() => setDevice("phone")} title="Phone width" aria-label="Phone width">
                      <span className="icon">smartphone</span>
                    </button>
                  </div>
                  <button className={s.iconBtn} onClick={() => setReload((r) => r + 1)} title="Reload" aria-label="Reload">
                    <span className="icon">refresh</span>
                  </button>
                  <a className={s.iconBtn} href={preview} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
                    <span className="icon">open_in_new</span>
                  </a>
                </div>
                <div className={s.stage}>
                  <iframe key={`${preview}-${reload}`} src={preview} title="Live preview" className={`${s.frame} ${device === "phone" ? s.phone : ""}`} />
                </div>
              </section>
            )}

            <section className={s.panel}>
              <div className={s.panelHead}>
                <h3>Tasks</h3>
                <span className="muted small">{tasksDone} of {list.length} done</span>
              </div>
              {list.length === 0 && <p className={`muted ${s.empty}`}>The project manager is splitting the work…</p>}
              {list.length > 0 && (
                <div className={s.lanes}>
                  {LANES.map((lane) => {
                    const laneTasks = list.filter((t) => t.agent === lane.agent);
                    return (
                      <div key={lane.agent} className={s.lane}>
                        <div className={s.laneHead}>
                          <Avatar who={AGENT_LOOK[lane.agent]} size="sm" />
                          <span className={s.laneName}>{lane.label}</span>
                          <span className="muted small">{laneTasks.filter((t) => t.status === "done").length}/{laneTasks.length}</span>
                        </div>
                        {laneTasks.length === 0 && <p className="muted small">Nothing yet</p>}
                        {laneTasks.map((t) => (
                          <div key={t.id} className={`${s.task} ${s["t_" + t.status]}`}>
                            <div className={s.taskTop}>
                              <span className={s.taskId}>{t.id}</span>
                              {t.id.startsWith("FIX") && <span className={s.fixTag}>fix</span>}
                              <span className={`icon ${s.taskIcon}`} aria-label={t.status}>{TASK_ICON[t.status]}</span>
                            </div>
                            <p className={s.taskTitle}>{t.title}</p>
                            {t.files.length > 0 && (
                              <div className={s.files}>
                                {t.files.map((f) => (
                                  <span key={f} className={s.file} title={f}>{f}</span>
                                ))}
                              </div>
                            )}
                            {t.status === "waiting" && t.dependsOn.length > 0 && (
                              <span className={s.waits}>after {t.dependsOn.join(", ")}</span>
                            )}
                            {t.status === "running" && <span className={s.bar} />}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className={s.sideCol}>
            <section className={s.panel}>
              <div className={s.panelHead}>
                <h3>Edge-case tests</h3>
                {runs > 1 && <span className="muted small">run {runs}</span>}
              </div>
              {testList.length === 0 ? (
                <p className={`muted ${s.empty}`}>Tests run when the code is written.</p>
              ) : (
                <>
                  <div className={s.score}>
                    <svg width="84" height="84" viewBox="0 0 84 84" className={s.ring}>
                      <circle cx="42" cy="42" r={R} className={s.ringBg} />
                      <circle
                        cx="42" cy="42" r={R}
                        className={`${s.ringFg} ${pct === 1 ? s.ringGood : ""}`}
                        strokeDasharray={`${C * pct} ${C}`}
                        transform="rotate(-90 42 42)"
                      />
                    </svg>
                    <div>
                      <div className={s.scoreBig}>{passed}<span>/{testList.length}</span></div>
                      <div className="muted small">
                        {passed === testList.length ? "all passing" : `${testList.length - passed} failing`}
                      </div>
                    </div>
                  </div>
                  <ul className={s.tests}>
                    {testList
                      .sort(([, a], [, b]) => Number(a.passed) - Number(b.passed))
                      .map(([name, t]) => (
                        <li key={name}>
                          {!t.passed && t.detail ? (
                            <details className={s.test}>
                              <summary>
                                <span className={`icon ${s.bad}`}>close</span>
                                <span>{name}</span>
                              </summary>
                              <pre className={s.detail}>{t.detail}</pre>
                            </details>
                          ) : (
                            <div className={s.test}>
                              <span className={`icon ${t.passed ? s.good : s.bad}`}>{t.passed ? "check" : "close"}</span>
                              <span>{name}</span>
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </section>

            <section className={s.panel}>
              <div className={s.panelHead}>
                <h3>Team feed</h3>
                <span className="muted small">{messages.length}</span>
              </div>
              <div className={s.feed} ref={feedRef}>
                {messages.length === 0 && <p className={`muted ${s.empty}`}>Agents post here as they finish their work.</p>}
                {messages.map((m, i) => (
                  <div key={i} className={s.msg}>
                    <Avatar who={AGENT_LOOK[m.agent] ?? "moderator"} size="sm" />
                    <div className={s.msgBody}>
                      <span className={s.msgAgent}>{m.agent}</span>
                      <p>{m.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
