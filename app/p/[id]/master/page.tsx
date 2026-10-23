"use client";
// Master prompt: the one document the build team works from. The user reads it, can edit it, then approves the build.
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Markdown } from "@/components/Markdown";
import { Typing } from "@/components/Avatar";
import { useProject } from "@/components/useProject";

const JOBS: [string, string][] = [
  ["account_tree", "Architect"],
  ["dns", "Backend developer"],
  ["web", "Frontend developer"],
  ["palette", "Designer"],
  ["fact_check", "QA tester"],
  ["bug_report", "Debugger"],
];

export default function Master({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { project: p, problem, act } = useProject(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (p?.masterPrompt && !editing) setDraft(p.masterPrompt);
  }, [p?.masterPrompt, editing]);

  if (!p) return <Shell project={null} page="master">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;

  const ready = Boolean(p.masterPrompt) && !p.busy;
  const last = p.rounds.at(-1);

  async function save() {
    if (await act("update-master", { text: draft })) setEditing(false);
  }

  async function approve() {
    setStarting(true);
    if (editing) await act("update-master", { text: draft });
    const r = await fetch(`/api/projects/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) });
    const d = await r.json();
    if (d.buildId) router.push(`/build/${d.buildId}?project=${id}`);
    else setStarting(false);
  }

  return (
    <Shell project={p} page="master">
      <div className="stack" style={{ gap: 6 }}>
        <span className="label neon"><span className="led" /> Specification lock // master prompt</span>
        <h1>The master prompt</h1>
        <p className="muted">Everything the build team will work from: your app, the council's agreements, and each agent's job.</p>
      </div>
      {problem && <div className="error-box">{problem}</div>}
      {p.error && <div className="error-box"><span className="grow">{p.error}</span><button className="btn ghost" onClick={() => act("retry")}>Retry</button></div>}
      {p.stage === "discovery" || p.stage === "council" ? (
        <div className="notice"><span>The master prompt is written after the council finishes.</span><Link className="btn ghost" href={`/p/${id}/${p.stage}`}>Back to the {p.stage === "council" ? "council" : "discovery room"}</Link></div>
      ) : null}

      <div className="doc">
        <section className="panel">
          {!p.masterPrompt ? (
            <div className="row"><Typing /><span className="muted">{p.busy ?? "Waiting for the council…"}</span></div>
          ) : editing ? (
            <textarea id="master-editor" className="editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <Markdown text={p.masterPrompt} />
          )}
        </section>

        <aside className="stack">
          <div className="panel">
            <span className="label">// Agent assignments</span>
            {JOBS.map(([icon, name]) => (
              <div className="row" key={name}><span className="icon" style={{ color: "var(--neon)" }}>{icon}</span><span>{name}</span><span className="chip green" style={{ marginLeft: "auto" }}>Assigned</span></div>
            ))}
          </div>
          <div className="panel">
            <span className="label">// Readiness</span>
            <span className="bigscore">{last ? Math.round(last.confidence * 100) : 0}%</span>
            <span className="small muted">{p.rounds.length} council round{p.rounds.length === 1 ? "" : "s"} · {p.asked.length} answers from you · {p.minutes.defaults.length} defaults</span>
          </div>
          {p.stage === "master" && (
            <div className="stack">
              {editing ? (
                <button className="btn ghost" onClick={save} disabled={!ready}>Save edits</button>
              ) : (
                <button className="btn ghost" onClick={() => setEditing(true)} disabled={!ready}><span className="icon">edit</span>Edit</button>
              )}
              <button className="btn" onClick={approve} disabled={!ready || starting}>
                {starting ? "Starting the build…" : "Approve & start the build"} <span className="icon">rocket_launch</span>
              </button>
            </div>
          )}
          {p.stage === "build" && p.buildId && <Link className="btn" href={`/build/${p.buildId}?project=${id}`}>Open the build</Link>}
        </aside>
      </div>
    </Shell>
  );
}
