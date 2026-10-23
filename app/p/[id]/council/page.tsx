"use client";
// Council arena: watch five AI seats debate the plan live (crossexam: sealed proposals → cross-examination → consensus)
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Typing } from "@/components/Avatar";
import { look, SEAT_ORDER } from "@/components/agents";
import { useProject } from "@/components/useProject";
import type { CouncilMessage, CouncilRound } from "@/lib/types";
import { Topology, TYPE_COLOR, targets } from "./Topology";
import s from "./council.module.css";

const PHASES = ["blind", "debate", "synthesis", "closed"] as const;
const PHASE_NAME: Record<string, string> = { blind: "Sealed claims", debate: "Cross-exam", synthesis: "Synthesis", closed: "Closed" };

function floorText(r: CouncilRound) {
  if (!r.speaking) return r.phase === "closed" ? "" : "Passing the floor…";
  const name = look(r.speaking).name;
  if (r.phase === "blind") return `${name} is writing a sealed proposal. Nobody can see it yet.`;
  if (r.phase === "debate") return `${name} is cross-examining the others' claims…`;
  return `${name} is writing the consensus report…`;
}

function clock(at: string) {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function route(m: CouncilMessage) {
  const to = targets(m);
  const dest = to.length >= SEAT_ORDER.length - (m.from === "moderator" ? 0 : 1) ? "all" : to.map((x) => look(x).name).join(", ");
  return `${m.from === "moderator" ? "Hub" : look(m.from).name} → ${dest}`;
}

export default function Council({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { project: p, problem, act } = useProject(id);
  const router = useRouter();
  const [picked, setPicked] = useState<number | null>(null);
  const [pulse, setPulse] = useState<{ m: CouncilMessage; key: number } | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const seen = useRef<{ round: number; len: number } | null>(null);
  const r = p ? p.rounds[(picked ?? p.rounds.length) - 1] : undefined;

  // New message on the round we're watching: send it as a packet and keep the event list at the bottom
  useEffect(() => {
    if (!r) return;
    const prev = seen.current;
    seen.current = { round: r.round, len: r.messages.length };
    if (prev && prev.round === r.round && r.messages.length > prev.len) {
      setPulse({ m: r.messages[r.messages.length - 1], key: Date.now() });
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
    } else if (!prev || prev.round !== r.round) {
      setPulse(null);
      setSel(null);
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
    }
  }, [r]);

  // Watched a round finish and it has questions for the user: show the score briefly, then go answer them
  const wasLive = useRef(false);
  useEffect(() => {
    if (!p) return;
    const running = p.rounds.at(-1)?.status === "running";
    if (wasLive.current && !running && p.stage === "discovery" && p.queue.length > p.queueIndex) {
      const t = setTimeout(() => router.push(`/p/${id}/discovery`), 3000);
      return () => clearTimeout(t);
    }
    wasLive.current = running;
  }, [p, id, router]);

  if (!p) return <Shell project={null} page="council">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;
  if (!r) {
    return (
      <Shell project={p} page="council">
        <div className="notice"><span>The council meets after the interview.</span><Link className="btn" href={`/p/${id}/discovery`}>Back to discovery</Link></div>
      </Shell>
    );
  }

  const live = r.status === "running";
  const pct = Math.round(r.confidence * 100);
  const at = PHASES.indexOf(r.phase);
  const shown = r.messages.find((m) => m.n === sel);

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

      <div className={s.sim}>
        <section className={s.stage}>
          <div className={s.stageHead}>
            <span className="label neon">// Topology · simulation</span>
            <span className={`chip ${live ? "amber" : "green"}`}>{live ? "Live" : "Adjourned"} · confidence {pct}%</span>
          </div>
          <div className={s.phases}>
            {PHASES.map((ph, i) => (
              <span key={ph} className={i < at || (!live && i === at) ? s.past : i === at ? s.now : ""}>{i < at || (!live && i === at) ? "✓ " : ""}{PHASE_NAME[ph]}</span>
            ))}
          </div>
          <Topology r={r} pulse={pulse} />
          <div className={s.legend}>
            {Object.entries(TYPE_COLOR).map(([k, c]) => <span key={k} style={{ ["--t" as string]: c }}><i />{k}</span>)}
          </div>
          {live && <span className={s.floor}>{floorText(r)} {r.speaking && <Typing />}</span>}
        </section>

        <section className={`panel ${s.events}`}>
          <div className="panel-head"><span className="label">// Event list</span><span className="chip">{r.messages.length} events</span></div>
          <div className={s.list} ref={list} aria-live="polite">
            {r.messages.length === 0 && <p className={s.empty}>The seats are writing sealed proposals. Events appear here when the envelopes open.</p>}
            {r.messages.map((m) => (
              <button key={m.n} className={`${s.evRow} ${sel === m.n ? s.picked : ""}`} onClick={() => { setSel(m.n); setPulse({ m, key: Date.now() }); }}>
                <span className={s.evTime}>{clock(m.at)}</span>
                <span className={s.evPath}>{route(m)}</span>
                <span className={s.type} style={{ ["--t" as string]: TYPE_COLOR[m.type] }}>{m.type}</span>
                <span className={s.evMsg}>{m.from === "moderator" ? m.msg.replace("phase -> ", "Phase: ") : m.msg}</span>
              </button>
            ))}
          </div>
          {shown ? (
            <div className={s.detail}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label" style={{ color: look(shown.from).color }}>#{shown.n} · {route(shown)}</span>
                <span className={s.type} style={{ ["--t" as string]: TYPE_COLOR[shown.type] }}>{shown.type}</span>
              </div>
              <p>{shown.msg}</p>
              {shown.analysis && (<><span className="label">Reasoning</span><p className={s.analysis}>{shown.analysis}</p></>)}
            </div>
          ) : (
            <p className="small muted">Click an event to read the full message and replay its packet.</p>
          )}
        </section>
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
