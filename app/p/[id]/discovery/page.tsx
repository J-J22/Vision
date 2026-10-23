"use client";
// Discovery room: Vision interviews the user, and later relays the council's questions — always one at a time.
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Avatar, Typing } from "@/components/Avatar";
import { look, SEAT_ORDER } from "@/components/agents";
import { useProject } from "@/components/useProject";

const KEYS = "ABCDE";
const LEVEL: Record<string, string> = { beginner: "Non-technical", "some-tech": "Some tech", developer: "Developer" };

export default function Discovery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { project: p, problem, act } = useProject(id);
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const lastStage = useRef<string | null>(null);

  // Follow the project when the interview hands over to the council
  useEffect(() => {
    if (!p) return;
    if (lastStage.current === "discovery" && p.stage === "council") router.push(`/p/${id}/council`);
    lastStage.current = p.stage;
  }, [p, id, router]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [p?.chat.length, p?.busy]);

  if (!p) return <Shell project={null} page="discovery">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;

  const last = p.chat.at(-1);
  const waiting = p.stage === "discovery" && !p.busy && last && last.from !== "user";
  const history = waiting ? p.chat.slice(0, -1) : p.chat;
  const councilQuestion = p.queue.length > 0;
  const round = p.rounds.at(-1);
  const answer = (text.trim() || choice).trim();

  async function send(value: string) {
    if (!value) return;
    setSending(true);
    const ok = await act("answer", { text: value });
    setSending(false);
    if (ok) {
      setChoice("");
      setText("");
    }
  }

  const facts = [
    ["Role", p.facts.role],
    ["Coding", p.facts.level ? LEVEL[p.facts.level] : ""],
    ["Idea", p.facts.idea],
    ["For", p.facts.audience],
    ["Must do well", p.facts.mustHave],
    ["Design feel", p.facts.designFeel],
    ["Colors", p.facts.designColors],
    ["Devices", p.facts.devices],
  ].filter(([, v]) => v);
  const intakeAsked = p.chat.filter((m) => m.from === "vision" && m.options !== undefined).length;

  return (
    <Shell project={p} page="discovery">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="label neon"><span className="led" /> Discovery session // {councilQuestion ? `council round ${round?.round}` : "interview"}</span>
          <h1>{councilQuestion ? "The council has questions" : p.intakeDone ? "Interview complete" : "Let's get to know you"}</h1>
        </div>
        {p.facts.level && <span className="chip green">Talking at: {LEVEL[p.facts.level]} level</span>}
      </div>

      {problem && <div className="error-box">{problem}</div>}
      {p.error && (
        <div className="error-box">
          <span className="grow">{p.error}</span>
          <button className="btn ghost" onClick={() => act("retry")}>Retry</button>
        </div>
      )}
      {p.stage === "council" && (
        <div className="notice">
          <span>The council is in session, examining your plan.</span>
          <Link className="btn amber" href={`/p/${id}/council`}>Watch the debate <span className="icon">arrow_forward</span></Link>
        </div>
      )}
      {p.stage === "master" && (
        <div className="notice">
          <span>The council is done. {p.masterPrompt ? "Your master prompt is ready." : "Writing your master prompt…"}</span>
          <Link className="btn" href={`/p/${id}/master`}>Open the master prompt <span className="icon">arrow_forward</span></Link>
        </div>
      )}

      <div className="room">
        <aside className="panel spec">
          <div className="panel-head"><span className="label">// Active specification</span><span className="chip">{facts.length} known</span></div>
          <div className="factlist">
            {facts.length === 0 && <p className="small muted">What Vision learns about you and your idea shows up here.</p>}
            {facts.map(([k, v]) => (
              <div className="fact" key={k}><span className="label">{k}</span><b>{v}</b></div>
            ))}
          </div>
          {p.asked.length > 0 && (
            <>
              <span className="label">// Resolved decisions</span>
              <div className="factlist">
                {p.asked.map((a, i) => (
                  <div className="fact" key={i}><span className="label">Q{i + 1}: {a.area}</span><b>{a.answer}</b></div>
                ))}
              </div>
            </>
          )}
        </aside>

        <section className="stack" style={{ gap: 16 }}>
          <div className="thread" aria-live="polite">
            {history.map((m) => (
              <div key={m.id} className={`msg ${m.from === "user" ? "user" : ""}`}>
                <Avatar who={m.from === "user" ? "user" : m.from} size="sm" />
                <div className="bubble">
                  <div className="who"><span className="label" style={{ color: look(m.from).color }}>{look(m.from).name}</span><span className="label">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
            {p.busy && p.stage === "discovery" && (
              <div className="msg">
                <Avatar who="vision" size="sm" speaking />
                <div className="stack" style={{ gap: 4 }}><Typing /><span className="small muted">{p.busy}</span></div>
              </div>
            )}
          </div>

          {waiting && last && (
            <div className="qcard">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="row" style={{ gap: 8 }}>
                  <Avatar who={last.from} speaking />
                  <span className="stack" style={{ gap: 0 }}>
                    <span className="label" style={{ color: look(last.from).color }}>{look(last.from).name}{councilQuestion ? " asks" : ""}</span>
                    <span className="label">
                      {councilQuestion ? `Question ${String(p.questionNumber).padStart(2, "0")} // ${String(p.questionTotal).padStart(2, "0")}` : `Question ${String(intakeAsked).padStart(2, "0")}`}
                    </span>
                  </span>
                </span>
                {councilQuestion && p.current?.blocking && <span className="chip amber">Blocks the build</span>}
              </div>
              {councilQuestion && (
                <div className="progress"><span style={{ width: `${((p.questionNumber - 1) / p.questionTotal) * 100}%` }} /></div>
              )}
              <p className="qtext">{last.text}</p>
              {last.why && <p className="why">{last.why}</p>}
              {last.options && last.options.length > 0 && (
                <div className="opts" role="radiogroup" aria-label="Answer options">
                  {last.options.map((o, i) => (
                    <button
                      key={o.label}
                      type="button"
                      role="radio"
                      aria-checked={choice === o.label}
                      className={`opt ${choice === o.label ? "on" : ""}`}
                      onClick={() => { setChoice(o.label); setText(""); }}
                      onDoubleClick={() => send(o.label)}
                    >
                      <span className="key">{KEYS[i]}</span>
                      <span>{o.label}</span>
                      {o.recommended ? <span className="chip neon">Recommended</span> : <span />}
                    </button>
                  ))}
                </div>
              )}
              <form className="freeform" onSubmit={(e) => { e.preventDefault(); send(answer); }}>
                <input
                  id="answer"
                  value={text}
                  onChange={(e) => { setText(e.target.value); if (e.target.value) setChoice(""); }}
                  placeholder={last.options?.length ? "Or type your own answer" : "Type your answer"}
                  autoFocus
                />
                <button className="btn" type="submit" disabled={!answer || sending}>
                  {sending ? "Sending…" : councilQuestion && p.questionNumber === p.questionTotal ? "Submit & send to council" : "Submit"} <span className="icon">arrow_forward</span>
                </button>
              </form>
              {councilQuestion && (
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="small muted">Anything you skip is decided with a sensible default, written down in the master prompt.</span>
                  <button className="btn ghost" onClick={() => act("skip-questions")}>Skip the rest, use defaults</button>
                </div>
              )}
            </div>
          )}
          <div ref={bottom} />
        </section>

        <aside className="stack">
          <div className="panel monitor">
            <div className="panel-head"><span className="label">// Council monitor</span><span className={`chip ${round?.status === "running" ? "amber" : round ? "green" : ""}`}>{round?.status === "running" ? "In session" : round ? `Round ${round.round} done` : "Standby"}</span></div>
            {SEAT_ORDER.map((s) => {
              const said = round?.messages.filter((m) => m.from === s).at(-1);
              return (
                <div className="seat" key={s}>
                  <Avatar who={s} size="sm" speaking={round?.speaking === s} dim={!round} />
                  <div className="grow">
                    <span className="label" style={{ color: look(s).color }}>{look(s).name}</span>
                    <p>{said ? `"${said.msg}"` : round?.speaking === s ? "Speaking…" : round ? "Waiting for the floor" : look(s).role}</p>
                  </div>
                </div>
              );
            })}
            {round && <Link href={`/p/${id}/council`} className="btn ghost">Open the council arena</Link>}
          </div>
          {round?.status === "done" && (
            <div className="panel">
              <span className="label">// Plan confidence</span>
              <div className="ring" style={{ ["--p" as string]: Math.round(round.confidence * 100) }}>
                <div><b>{Math.round(round.confidence * 100)}%</b><span className="label">confidence</span></div>
              </div>
              <span className="small muted">Builds start at 80% with nothing blocking, or after 3 rounds. Council agreement: {Math.round(round.agreement * 100)}%.</span>
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
