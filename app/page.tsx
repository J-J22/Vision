"use client";
// Home: what Vision is, and the button that starts a project
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Shell";

const PIPELINE = [
  ["01", "Discovery room", "Vision interviews you, one question at a time, in your words"],
  ["02", "Agent council", "Five AI reviewers debate your plan and cross-examine each other"],
  ["03", "Your answers", "The council's questions come back to you, simply worded"],
  ["04", "Master prompt", "One spec: the app, plus every agent's job. You approve it"],
  ["05", "Build pipeline", "Agents build, test and fix it, then prove it works"],
];

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const p = await (await fetch("/api/projects", { method: "POST" })).json();
      router.push(`/p/${p.id}/discovery`);
    } catch {
      setError("Couldn't start a project. Is the server running?");
      setBusy(false);
    }
  }

  return (
    <div className="scanlines" style={{ minHeight: "100vh" }}>
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
        <div style={{ maxWidth: 220 }}><Brand /></div>
      </div>
      <section className="hero">
        <span className="prompt-line">root@vision:~$ init-project --interactive</span>
        <h1>Tell it what you want.<br />A council of AIs makes sure it's <em>the right thing</em>, then a team builds it.</h1>
        <p className="muted" style={{ maxWidth: 640, fontSize: 14 }}>
          Most AI builders start coding from whatever you typed. Vision first learns who you are, has five AI reviewers debate your plan,
          asks you only what matters, and hands its agents one approved master prompt.
        </p>
        <div className="row">
          <button className="btn" onClick={start} disabled={busy}>
            <span className="icon">bolt</span>{busy ? "Starting…" : "Start a new project"}
          </button>
          <a className="btn ghost" href="/build/sample">Watch a sample build</a>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="pipeline">
          {PIPELINE.map(([n, name, text]) => (
            <div key={n}>
              <span className="label neon">{n} //</span>
              <h3>{name}</h3>
              <span className="small muted">{text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
