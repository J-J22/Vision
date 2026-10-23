"use client";
// AI parts: plug in API keys (stored encrypted on this server) and choose which AI sits in each position of the flow.
// Any AI can go anywhere; Vision recommends parts and warns when one is underpowered for its position.
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";

type Verdict = { level: "ok" | "bottleneck" | "wont-fit" | "unknown"; text: string };
type Rating = { coding: number; reasoning: number; speed: number; context?: number } | null;
type ChainPart = { part: string; provider: string; model: string; verdict: Verdict; rating: Rating; tokens: number };
type Provider = {
  id: string;
  name: string;
  keyUrl: string;
  goodAt: string;
  limits: string;
  status: { source: "dashboard" | "env" | "none"; last4?: string };
  models: { id: string; context?: number; rated: boolean }[];
};
type Slot = {
  id: string;
  stage: string;
  title: string;
  job: string;
  needs: { coding?: number; reasoning?: number; speed?: number; context?: number };
  chosen: string | null;
  recommended: string | null;
  chain: ChainPart[];
  wants: string[];
};
type Parts = { providers: Provider[]; slots: Slot[] };

const STAGES: [string, string][] = [
  ["discovery", "Discovery room"],
  ["council", "Agent council"],
  ["master", "Master prompt"],
  ["build", "Build team"],
];

const VERDICT_CHIP: Record<Verdict["level"], [string, string]> = {
  ok: ["green", "Compatible"],
  bottleneck: ["amber", "Not enough power"],
  "wont-fit": ["red", "Won't fit"],
  unknown: ["", "Unrated"],
};

function needsText(n: Slot["needs"]) {
  return [n.coding && `Coding ${n.coding}+`, n.reasoning && `Reasoning ${n.reasoning}+`, n.speed && `Speed ${n.speed}+`, n.context && `Reads ${Math.round(n.context / 1000)}k+`].filter(Boolean) as string[];
}

function KeyForm({ provider, onSaved, where = "", compact = false }: { provider: Provider; onSaved: (d: Parts) => void; where?: string; compact?: boolean }) {
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
    setKey("");
    onSaved(d);
  }

  return (
    <form className="keyform" onSubmit={save}>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          id={`key-${provider.id}${where ? `-${where}` : ""}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={`Paste your ${provider.name.split(" ")[0]} key`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label={`${provider.name} API key`}
        />
        <button className="btn" type="submit" disabled={busy || key.trim().length < 10}>{busy ? "Checking…" : "Plug in"}</button>
      </div>
      {error && <span className="small" style={{ color: "var(--red)" }}>{error}</span>}
      {!compact && (
        <a className="small" href={provider.keyUrl} target="_blank" rel="noreferrer">Get a free {provider.name.split(" ")[0]} key ↗</a>
      )}
    </form>
  );
}

export default function PartsPage() {
  const [data, setData] = useState<Parts | null>(null);
  const [problem, setProblem] = useState("");

  async function load() {
    try {
      setData(await (await fetch("/api/parts")).json());
    } catch {
      setProblem("Couldn't reach Vision. Is `npm run dev` running?");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function post(body: object) {
    const r = await fetch("/api/parts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) return setProblem(d.error);
    setProblem("");
    setData(d);
  }

  if (!data) return <Shell project={null} page="parts">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading AI parts…</p>}</Shell>;

  const byId = Object.fromEntries(data.providers.map((p) => [p.id, p]));
  const connected = data.providers.filter((p) => p.status.source !== "none");

  return (
    <Shell project={null} page="parts">
      <div className="stack" style={{ gap: 6 }}>
        <span className="label neon"><span className="led" /> Assembly // AI parts</span>
        <h1>Plug in your AIs</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          Every box in Vision&apos;s flow is a position for an AI. Plug in free keys below, and Vision puts the best part in each position.
          You can put any AI anywhere; Vision tells you when one is underpowered for its job.
        </p>
      </div>
      {problem && <div className="error-box"><span className="grow">{problem}</span><button className="btn ghost" onClick={() => setProblem("")}>Dismiss</button></div>}

      <section className="stack">
        <span className="label">// Power: API keys ({connected.length} of {data.providers.length} plugged in)</span>
        <div className="provgrid">
          {data.providers.map((p) => (
            <article key={p.id} className={`panel ${p.status.source !== "none" ? "glow" : ""}`}>
              <div className="panel-head">
                <h3>{p.name}</h3>
                {p.status.source === "none" ? <span className="chip">Not plugged in</span> : <span className="chip green"><span className="led" />Connected</span>}
              </div>
              <p className="small muted">{p.goodAt}</p>
              <span className="label">{p.limits || "No per-minute cap"}</span>
              {p.status.source === "none" ? (
                <KeyForm provider={p} onSaved={setData} />
              ) : (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small">
                    Key ••••{p.status.last4} · {p.status.source === "dashboard" ? "saved here, encrypted" : "from .env.local"} · {p.models.length} models
                  </span>
                  {p.status.source === "dashboard" && <button className="btn ghost" onClick={() => post({ action: "remove-key", provider: p.id })}>Unplug</button>}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {STAGES.map(([stage, name]) => (
        <section key={stage} className="stack">
          <span className="label">// {name}</span>
          <div className="slotgrid">
            {data.slots.filter((s) => s.stage === stage).map((s) => {
              const active = s.chain[0];
              const [chipClass, chipText] = active ? VERDICT_CHIP[active.verdict.level] : ["red", "Empty"];
              const missing = s.wants.map((id) => byId[id]).filter(Boolean);
              return (
                <article key={s.id} className={`panel slot ${active ? active.verdict.level : "empty"}`}>
                  <div className="panel-head">
                    <div className="stack" style={{ gap: 2 }}>
                      <h3>{s.title}</h3>
                      <span className="small muted">{s.job}</span>
                    </div>
                    <span className={`chip ${chipClass}`}>{chipText}</span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {needsText(s.needs).map((n) => <span key={n} className="chip">{n}</span>)}
                  </div>

                  {active ? (
                    <div className="part">
                      <span className="label">In this position{s.chosen ? " (your pick)" : ""}</span>
                      <b className="mono">{byId[active.provider]?.name.split(" ")[0]} · {active.model}</b>
                      {active.rating && <span className="small muted">Coding {active.rating.coding}/5 · Reasoning {active.rating.reasoning}/5 · Speed {active.rating.speed}/5{active.tokens ? ` · ${active.tokens.toLocaleString()} tokens used` : ""}</span>}
                      {active.verdict.level !== "ok" && <span className="small" style={{ color: active.verdict.level === "wont-fit" ? "var(--red)" : active.verdict.level === "bottleneck" ? "var(--amber)" : "var(--muted)" }}>{active.verdict.text}</span>}
                    </div>
                  ) : (
                    <p className="small" style={{ color: "var(--red)" }}>No AI can run this position yet. Plug in a key.</p>
                  )}

                  {s.chosen && s.recommended && s.chosen !== s.recommended && (
                    <button className="btn ghost" onClick={() => post({ action: "choose", slot: s.id, part: null })}>Use recommended: {s.recommended.split(":").slice(1).join(":")}</button>
                  )}

                  {connected.length > 0 && (
                    <select
                      id={`slot-${s.id}`}
                      className="partpick"
                      value=""
                      onChange={(e) => e.target.value && post({ action: "choose", slot: s.id, part: e.target.value })}
                      aria-label={`Put another AI in ${s.title}`}
                    >
                      <option value="">Put another AI here…</option>
                      {connected.map((p) => (
                        <optgroup key={p.id} label={p.name}>
                          {p.models.map((m) => (
                            <option key={m.id} value={`${p.id}:${m.id}`}>{m.id}{`${p.id}:${m.id}` === s.recommended ? "  ★ recommended" : m.rated ? "" : "  (unrated)"}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}

                  {s.chain.length > 1 && (
                    <span className="small muted">Spares if it fails: {s.chain.slice(1, 4).map((c) => c.model).join(", ")}</span>
                  )}

                  {missing.length > 0 && (
                    <details className="inline-key">
                      <summary className="small">Recommended here too: {missing.map((p) => p.name.split(" ")[0]).join(", ")}. Plug in a key</summary>
                      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                        {missing.map((p) => <KeyForm key={p.id} provider={p} onSaved={setData} where={s.id} compact />)}
                      </div>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </Shell>
  );
}
