"use client";
// Connect your AI: plug in free API keys (checked, then stored encrypted on this server), and optionally
// choose which AI does each step. Any AI can go anywhere; Vision warns when one is underpowered.
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";

type Verdict = { level: "ok" | "bottleneck" | "wont-fit" | "unknown"; text: string };
type ChainPart = { part: string; provider: string; model: string; verdict: Verdict };
type Provider = {
  id: string;
  name: string;
  keyUrl: string;
  goodAt: string;
  status: { source: "dashboard" | "env" | "none"; last4?: string };
  models: { id: string; rated: boolean }[];
};
type Slot = { id: string; stage: string; title: string; job: string; chosen: string | null; recommended: string | null; chain: ChainPart[]; wants: string[] };
type Parts = { providers: Provider[]; slots: Slot[] };

const STAGES: [string, string][] = [
  ["discovery", "Discovery"],
  ["council", "Council"],
  ["master", "Plan"],
  ["build", "Build"],
];

// Model ids are long ("deepseek-ai/deepseek-v4-pro"); show the readable end
const short = (model: string) => model.split("/").pop() ?? model;

function Connect({ provider, onDone, onCancel }: { provider: Provider; onDone: (d: Parts) => void; onCancel: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-key", provider: provider.id, key }) });
    const d = await r.json();
    setBusy(false);
    if (d.error) return setError(d.error);
    onDone(d);
  }

  return (
    <form className="connect" onSubmit={save}>
      <p className="small muted">
        1. Get a free key from <a href={provider.keyUrl} target="_blank" rel="noreferrer">{provider.name} ↗</a>
        <br />2. Paste it here. It&apos;s checked, then stored encrypted on this computer.
      </p>
      <div className="connect-row">
        <input
          id={`key-${provider.id}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="Paste your key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label={`${provider.name} API key`}
        />
        <button className="btn" type="submit" disabled={busy || key.trim().length < 10}>{busy ? "Checking…" : "Connect"}</button>
      </div>
      {error && <p className="small" style={{ color: "var(--red)" }}>{error}</p>}
      <button type="button" className="linkish" onClick={onCancel}>Cancel</button>
    </form>
  );
}

export default function PartsPage() {
  const [data, setData] = useState<Parts | null>(null);
  const [problem, setProblem] = useState("");
  const [open, setOpen] = useState<string | null>(null); // provider being connected
  const [changing, setChanging] = useState<string | null>(null); // slot being changed

  useEffect(() => {
    fetch("/api/parts").then((r) => r.json()).then(setData).catch(() => setProblem("Couldn't reach Vision. Is it running?"));
  }, []);

  async function post(body: object) {
    const r = await fetch("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) return setProblem(d.error);
    setProblem("");
    setData(d);
  }

  if (!data) return <Shell project={null} page="parts">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;

  const connected = data.providers.filter((p) => p.status.source !== "none");
  const byId = Object.fromEntries(data.providers.map((p) => [p.id, p]));
  const issues = data.slots.filter((s) => !s.chain[0] || s.chain[0].verdict.level !== "ok").length;

  return (
    <Shell project={null} page="parts">
      <div className="calm">
        <div className="calm-head">
          <h1>Connect your AI</h1>
          <p className="muted">Vision runs on free AI services. Connect one to start; each extra one makes Vision faster and smarter.</p>
        </div>
        {problem && <div className="error-box"><span className="grow">{problem}</span><button className="linkish" onClick={() => setProblem("")}>Dismiss</button></div>}

        <section className="calm-list" aria-label="AI services">
          {data.providers.map((p, i) => {
            const on = p.status.source !== "none";
            return (
              <div key={p.id} className={`prov ${on ? "on" : ""}`}>
                <div className="prov-row">
                  <span className="prov-mark" aria-hidden="true">{p.name[0]}</span>
                  <div className="grow">
                    <b>{p.name}</b>
                    {!on && i === 0 && connected.length === 0 && <span className="prov-tag">Start here</span>}
                    <p className="small muted">{p.goodAt}</p>
                  </div>
                  {on ? (
                    <div className="prov-on">
                      <span className="small">✓ Connected <span className="muted">····{p.status.last4}</span></span>
                      {p.status.source === "dashboard" ? (
                        <button className="linkish" onClick={() => post({ action: "remove-key", provider: p.id })}>Disconnect</button>
                      ) : (
                        <span className="small muted">from .env.local</span>
                      )}
                    </div>
                  ) : open !== p.id ? (
                    <button className="btn ghost" onClick={() => setOpen(p.id)}>Connect</button>
                  ) : null}
                </div>
                {!on && open === p.id && <Connect provider={p} onDone={(d) => { setData(d); setOpen(null); }} onCancel={() => setOpen(null)} />}
              </div>
            );
          })}
        </section>

        {connected.length > 0 && (
          <details className="calm-more">
            <summary>
              <b>Who does what</b>
              <span className="muted"> · Vision picks the best AI for each step{issues ? ` · ${issues} could be stronger` : ""}</span>
            </summary>
            {STAGES.map(([stage, name]) => (
              <div key={stage} className="who">
                <span className="label">{name}</span>
                {data.slots.filter((s) => s.stage === stage).map((s) => {
                  const a = s.chain[0];
                  const level = a ? a.verdict.level : "wont-fit";
                  return (
                    <div key={s.id} className="who-row">
                      <div className="who-main">
                        <i className={`dot ${level}`} aria-hidden="true" />
                        <span className="grow" title={s.job}>{s.title}</span>
                        <span className="small muted who-ai">{a ? `${byId[a.provider]?.name} · ${short(a.model)}` : "No AI yet"}</span>
                        <button className="linkish" onClick={() => setChanging(changing === s.id ? null : s.id)}>{changing === s.id ? "Close" : "Change"}</button>
                      </div>
                      {a && level !== "ok" && <p className="small who-note">{a.verdict.text}</p>}
                      {changing === s.id && (
                        <div className="who-change">
                          <select
                            id={`slot-${s.id}`}
                            value=""
                            onChange={(e) => { if (e.target.value) { post({ action: "choose", slot: s.id, part: e.target.value }); setChanging(null); } }}
                            aria-label={`Choose the AI for ${s.title}`}
                          >
                            <option value="">Choose an AI…</option>
                            {connected.map((p) => (
                              <optgroup key={p.id} label={p.name}>
                                {p.models.map((m) => (
                                  <option key={m.id} value={`${p.id}:${m.id}`}>{short(m.id)}{`${p.id}:${m.id}` === s.recommended ? "  · recommended" : ""}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                          {s.chosen && <button className="linkish" onClick={() => { post({ action: "choose", slot: s.id, part: null }); setChanging(null); }}>Back to recommended</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </details>
        )}
      </div>
    </Shell>
  );
}
