"use client";
// Discovery: one question at a time, nothing else competing for attention.
// Vision's interview first, then the council's questions. Past answers and what Vision knows sit behind toggles.
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Avatar, Typing } from "@/components/Avatar";
import { look } from "@/components/agents";
import { useProject } from "@/components/useProject";

export default function Discovery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { project: p, problem, act } = useProject(id);
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastStage = useRef<string | null>(null);

  // Follow the project when the interview hands over to the council
  useEffect(() => {
    if (!p) return;
    if (lastStage.current === "discovery" && p.stage === "council") router.push(`/p/${id}/council`);
    lastStage.current = p.stage;
  }, [p, id, router]);

  if (!p) return <Shell project={null} page="discovery">{problem ? <div className="error-box">{problem}</div> : <p className="muted">Loading…</p>}</Shell>;

  const last = p.chat.at(-1);
  const waiting = p.stage === "discovery" && !p.busy && last && last.from !== "user";
  const councilQuestion = p.queue.length > 0;
  const answer = (text.trim() || choice).trim();
  const answers = p.chat.filter((m) => m.from === "user");
  const facts = [
    ["Idea", p.facts.idea],
    ["For", p.facts.audience],
    ["You are", p.facts.role],
    ["Feel", p.facts.designFeel],
    ["Devices", p.facts.devices],
  ].filter(([, v]) => v);

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

  return (
    <Shell project={p} page="discovery">
      <div className="ask">
        {problem && <div className="error-box">{problem}</div>}
        {p.error && (
          <div className="error-box">
            <span className="grow">Something went wrong. {p.error}</span>
            <button className="btn ghost" onClick={() => act("retry")}>Try again</button>
          </div>
        )}

        {p.stage === "council" && (
          <div className="ask-card center">
            <h2>The council is reviewing your plan</h2>
            <p className="muted">Five AIs are checking it for gaps. Their questions come back here.</p>
            <Link className="btn" href={`/p/${id}/council`}>Watch</Link>
          </div>
        )}
        {p.stage === "master" && (
          <div className="ask-card center">
            <h2>{p.masterPrompt ? "Your plan is ready" : "Writing your plan…"}</h2>
            <Link className="btn" href={`/p/${id}/master`}>Open the plan</Link>
          </div>
        )}

        {p.busy && p.stage === "discovery" && (
          <div className="ask-card center">
            <Typing />
            <p className="muted">{p.busy}</p>
          </div>
        )}

        {waiting && last && (
          <div className="ask-card">
            <div className="ask-who">
              <Avatar who={last.from} size="sm" />
              <span>{look(last.from).name}</span>
              {councilQuestion && <span className="muted">· {p.questionNumber} of {p.questionTotal}</span>}
            </div>
            {councilQuestion && <div className="progress"><span style={{ width: `${((p.questionNumber - 1) / p.questionTotal) * 100}%` }} /></div>}

            <p className="ask-q">{last.text}</p>
            {last.why && (
              <details className="ask-why">
                <summary>Why this matters</summary>
                <p>{last.why}</p>
              </details>
            )}

            {last.options && last.options.length > 0 && (
              <div className="ask-opts" role="radiogroup" aria-label="Answer options">
                {last.options.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={choice === o.label}
                    className={`ask-opt ${choice === o.label ? "on" : ""}`}
                    onClick={() => { setChoice(o.label); setText(""); }}
                    onDoubleClick={() => send(o.label)}
                  >
                    <span>{o.label}</span>
                    {o.recommended && <span className="ask-rec">Recommended</span>}
                  </button>
                ))}
              </div>
            )}

            <form className="ask-free" onSubmit={(e) => { e.preventDefault(); send(answer); }}>
              <input
                id="answer"
                value={text}
                onChange={(e) => { setText(e.target.value); if (e.target.value) setChoice(""); }}
                placeholder={last.options?.length ? "Or write your own" : "Your answer"}
                autoComplete="off"
                autoFocus
              />
              <button className="btn" type="submit" disabled={!answer || sending}>{sending ? "…" : "Next"}</button>
            </form>

            {councilQuestion && (
              <button className="ask-skip" onClick={() => act("skip-questions")}>Skip the rest and let Vision decide</button>
            )}
          </div>
        )}

        {(answers.length > 0 || facts.length > 0) && (
          <details className="ask-more">
            <summary>What Vision knows so far ({facts.length + p.asked.length})</summary>
            <dl>
              {facts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
              {p.asked.map((a, i) => (<div key={i}><dt>{a.area}</dt><dd>{a.answer}</dd></div>))}
            </dl>
          </details>
        )}
      </div>
    </Shell>
  );
}
