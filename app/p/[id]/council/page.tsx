"use client";
// Council arena: watch five AI seats debate the plan live (crossexam: sealed proposals → cross-examination → consensus)
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Avatar, Typing } from "@/components/Avatar";
import { look, SEAT_ORDER } from "@/components/agents";
import { useProject } from "@/components/useProject";
import type { CouncilMessage, CouncilRound } from "@/lib/types";

const VERB: Record<string, string> = { claim: "proposes", verify: "verifies", challenge: "challenges", concede: "concedes", info: "" };
const TYPE_CHIP: Record<string, string> = { claim: "", verify: "green", challenge: "amber", concede: "green", info: "" };

function phaseIndex(r: CouncilRound) {
  if (r.phase === "blind") return 0;
  if (r.phase === "debate") return 1;
  return 2;
}

function floorText(r: CouncilRound) {
  if (!r.speaking) return r.phase === "closed" ? "" : "Passing the floor…";
  const name = look(r.speaking).name;
  if (r.phase === "blind") return `${name} is writing a sealed proposal. Nobody can see it yet.`;
  if (r.phase === "debate") return `${name} is cross-examining the others' claims…`;
  return `${name} is writing the consensus report…`;
}

function Turn({ m }: { m: CouncilMessage }) {
  return (
    <div className={`turn ${m.type}`}>
      <span className={`chip ${TYPE_CHIP[m.type]}`}>{m.type}</span>
      <p style={{ marginTop: 6 }}>{m.msg}</p>
      {m.analysis && (
        <details style={{ marginTop: 6 }}>
          <summary>Full reasoning</summary>
          <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{m.analysis}</p>
        </details>
      )}
    </div>
  );
}

export default function Council({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { project: p, problem, act } = useProject(id);
  const [picked, setPicked] = useState<number | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const r = p ? p.rounds[(picked ?? p.rounds.length) - 1] : undefined;

  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [r?.messages.length, r?.speaking]);

  if (!p) return <Shell project={null} page="council">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;
  if (!r) {
    return (
      <Shell project={p} page="council">
        <div className="notice"><span>The council meets after the interview.</span><Link className="btn" href={`/p/${id}/discovery`}>Back to discovery</Link></div>
      </Shell>
    );
  }

  const step = phaseIndex(r);
  const live = r.status === "running";
  const pct = Math.round(r.confidence * 100);

  return (
    <Shell project={p} page="council">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label neon"><span className={`led ${live ? "amber" : ""}`} /> Agent council // {live ? "in session" : "adjourned"}</span>
          <h1>Agent council <span style={{ color: "var(--neon)" }}>//</span> arena</h1>
        </div>
        <div className="row">
          {p.rounds.map((x) => (
            <button key={x.round} className={`btn ${x.round === r.round ? "" : "ghost"}`} style={{ padding: "7px 12px" }} onClick={() => setPicked(x.round)}>
              Round {x.round}
            </button>
          ))}
        </div>
      </div>

      {problem && <div className="error-box">{problem}</div>}
      {p.error && (
        <div className="error-box"><span className="grow">{p.error}</span><button className="btn ghost" onClick={() => act("retry")}>Retry</button></div>
      )}
      {r.engine === "fallback" && (
        <div className="notice"><span>crossexam couldn't run, so Vision's built-in panel reviewed the plan instead (no cross-examination this round).</span>{r.error && <details><summary>Why</summary><p className="small muted">{r.error}</p></details>}</div>
      )}

      <div className="tracker">
        {["Sealed proposals", "Cross-examination", "Consensus"].map((name, i) => (
          <div key={name} className={live && step === i ? "now" : step > i || !live ? "done" : ""}>
            <span className="label">Stage {String(i + 1).padStart(2, "0")} {step > i || !live ? "✓ done" : live && step === i ? "// active" : ""}</span>
            <h3>{name}</h3>
          </div>
        ))}
      </div>

      {live && (
        <div className="panel glow">
          <div className="row">
            {r.speaking ? <Avatar who={r.speaking} size="lg" speaking /> : <Avatar who="moderator" size="lg" />}
            <div className="grow stack" style={{ gap: 4 }}>
              <span className="label neon">On the floor</span>
              <span>{floorText(r)}</span>
            </div>
            <Typing />
          </div>
        </div>
      )}

      <div className="arena">
        {SEAT_ORDER.map((s) => {
          const a = look(s);
          const turns = r.messages.filter((m) => m.from === s);
          const sealed = r.sealed.includes(s);
          return (
            <article key={s} className={`seatcard ${r.speaking === s ? "speaking" : ""}`} style={{ ["--c" as string]: a.color }}>
              <div className="row">
                <Avatar who={s} speaking={r.speaking === s} />
                <div className="grow">
                  <h3>[{a.name.toUpperCase()}]</h3>
                  <span className="label">Role: {a.role}</span>
                </div>
                {r.speaking === s ? <span className="chip amber">Speaking</span> : sealed ? <span className="chip amber">Sealed</span> : turns.some((t) => t.type === "concede") ? <span className="chip green">Conceded</span> : turns.length ? <span className="chip green">On record</span> : <span className="chip">Waiting</span>}
              </div>
              {sealed && (
                <div className="sealed"><span className="icon">mail_lock</span><span className="small">Proposal sealed. It opens when cross-examination starts, so nobody copies anybody.</span></div>
              )}
              {turns.map((m) => <Turn key={m.n} m={m} />)}
              {!sealed && !turns.length && <p className="small muted">{r.speaking === s ? "Writing…" : "Hasn't spoken yet."}</p>}
            </article>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-head"><span className="label">// Debate transcript</span><span className={`chip ${live ? "amber" : "green"}`}>{live ? "Live" : `${r.messages.filter((m) => m.from !== "moderator").length} statements`}</span></div>
        <div className="transcript" aria-live="polite">
          {r.messages.length === 0 && <p className="small muted">The seats are writing sealed proposals. Their statements appear here when the envelopes open.</p>}
          {r.messages.map((m) =>
            m.from === "moderator" ? (
              <div key={m.n} className="mod">{m.msg.replace("phase -> ", "Moderator: ")}</div>
            ) : (
              <div key={m.n} className="line">
                <Avatar who={m.from} size="sm" />
                <div className={`say ${m.type}`}>
                  <span className="label" style={{ color: look(m.from).color }}>{look(m.from).name} {VERB[m.type]}</span>
                  <p>{m.msg}</p>
                </div>
              </div>
            ),
          )}
          {live && r.speaking && r.phase === "debate" && (
            <div className="line"><Avatar who={r.speaking} size="sm" speaking /><Typing /></div>
          )}
          <div ref={logEnd} />
        </div>
      </div>

      {r.status === "done" && (
        <section className="panel raised">
          <div className="panel-head">
            <h2>Official council consensus report</h2>
            <span className="chip">Round {r.round}</span>
          </div>
          <div className="report">
            <div className="stack">
              <span className="label green">// Agreed requirements</span>
              <ul className="checks">
                {r.consensus.length === 0 && <li><span className="icon">info</span><span className="muted">No separate agreements recorded this round.</span></li>}
                {r.consensus.map((c, i) => (<li key={i}><span className="icon">check</span><span>{c}</span></li>))}
              </ul>
              {r.disagreements.length > 0 && (
                <>
                  <span className="label amber">// Still disputed</span>
                  <ul className="checks warn">
                    {r.disagreements.map((d, i) => (<li key={i}><span className="icon">warning</span><span>{d}</span></li>))}
                  </ul>
                </>
              )}
            </div>
            <div className="stack">
              <div className="panel">
                <span className="label">Plan confidence</span>
                <span className="bigscore">{pct}%</span>
                <div className="segbar">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.round(pct / 10) ? "on" : ""} />)}</div>
                <span className="small muted">Council agreement {Math.round(r.agreement * 100)}% · {r.questions.length} question{r.questions.length === 1 ? "" : "s"} for you · {r.defaults.length} defaults</span>
              </div>
              {p.stage === "discovery" && p.queue.length > 0 && r.round === p.rounds.length && (
                <Link className="btn" href={`/p/${id}/discovery`}>Answer the council's {p.queue.length - p.queueIndex} question{p.queue.length - p.queueIndex === 1 ? "" : "s"} <span className="icon">arrow_forward</span></Link>
              )}
              {p.stage === "master" && (
                <Link className="btn" href={`/p/${id}/master`}>{p.masterPrompt ? "Open the master prompt" : "Writing the master prompt…"} <span className="icon">arrow_forward</span></Link>
              )}
              {r.synthesis && (
                <details>
                  <summary>Synthesis written by the architect seat</summary>
                  <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{r.synthesis}</p>
                </details>
              )}
            </div>
          </div>
        </section>
      )}
    </Shell>
  );
}
