"use client";
// Discovery screen: profile questions → idea → parliament rounds → approve.
// Left: the conversation step. Right: confidence meter, parliament members, live Blueprint.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Blueprint, MemberReview, UserQuestion } from "@/lib/types";

type View = {
  id: string;
  phase: "profile" | "idea" | "questions" | "done";
  profileQuestions?: { id: string; text: string; options: string[] }[];
  profile?: { level: string };
  blueprint: Blueprint;
  round: number;
  questions: UserQuestion[];
  reviews: MemberReview[];
  confidence: number;
  areaConfidence?: Record<string, number>;
  minutes: { decisions: string[]; defaults: string[]; disagreements: string[] };
  error?: string;
};

const MEMBER_TITLES: Record<string, string> = {
  architect: "Architect",
  product: "Product lead",
  security: "Security & payments",
  skeptic: "Skeptic",
};

const LEVEL_LABEL: Record<string, string> = { beginner: "Non-technical", "some-tech": "Some tech", developer: "Developer" };

async function call(body: object): Promise<View> {
  const res = await fetch("/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok && !data.id) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export default function Discovery() {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [idea, setIdea] = useState("");

  useEffect(() => {
    call({ action: "start" }).then(setView).catch((e) => setError(String(e.message)));
  }, []);

  async function act(action: string, payload?: object) {
    if (!view) return;
    setBusy(true);
    setError("");
    try {
      const next = await call({ sessionId: view.id, action, payload });
      if (next.error) setError(next.error);
      setView(next);
      setAnswers({});
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!view) return;
    setBusy(true);
    const res = await fetch("/api/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: view.id }) });
    const data = await res.json();
    if (data.buildId) router.push(`/build/${data.buildId}`);
    else {
      setError(data.error ?? "Couldn't start the build");
      setBusy(false);
    }
  }

  if (!view) return <main className="page">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const reviewing = busy && (view.phase === "idea" || view.phase === "questions");

  return (
    <main className="page">
      <div className="row">
        <h1>New project</h1>
        {view.profile && <span className="chip">{LEVEL_LABEL[view.profile.level] ?? view.profile.level}</span>}
        {view.round > 0 && <span className="chip warn">Round {view.round}</span>}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="split">
        <section className="card">
          {view.phase === "profile" && view.profileQuestions && (
            <>
              <h2>First, a bit about you</h2>
              <p className="muted small">So we can ask the rest in the right words.</p>
              {view.profileQuestions.map((q) => (
                <div className="q" key={q.id}>
                  <h3>{q.text}</h3>
                  <div className="opts">
                    {q.options.map((o) => (
                      <button key={o} type="button" className={`opt ${answers[q.id] === o ? "on" : ""}`} onClick={() => setAnswers({ ...answers, [q.id]: o })}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="row">
                <button className="btn" disabled={busy || view.profileQuestions.some((q) => !answers[q.id])} onClick={() => act("profile", { answers })}>
                  Continue
                </button>
              </div>
            </>
          )}

          {view.phase === "idea" && (
            <>
              <h2>What do you want to build?</h2>
              <p className="muted small">A sentence or two is enough. The review panel will ask about anything missing.</p>
              <textarea
                id="idea"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="A marketplace where students at my university buy and sell second-hand textbooks."
                disabled={busy}
              />
              <div className="row">
                <button className="btn" disabled={busy || idea.trim().length < 10} onClick={() => act("idea", { idea })}>
                  {busy ? "The panel is reviewing your idea…" : "Send to the review panel"}
                </button>
              </div>
            </>
          )}

          {view.phase === "questions" && (
            <>
              <h2>The panel has {view.questions.length} question{view.questions.length === 1 ? "" : "s"}</h2>
              <p className="muted small">Pick an answer or type your own. Anything you skip gets a sensible default.</p>
              {view.questions.map((q) => (
                <div className="q" key={q.id}>
                  <h3>{q.text}</h3>
                  {q.why && <p className="why">{q.why}</p>}
                  <div className="opts">
                    {q.options.map((o) => (
                      <button key={o.label} type="button" className={`opt ${answers[q.id] === o.label ? "on" : ""}`} onClick={() => setAnswers({ ...answers, [q.id]: o.label })}>
                        {o.label}
                        {o.recommended && <span className="rec">recommended</span>}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    id={`other-${q.id}`}
                    placeholder="Or type your own answer"
                    value={q.options.some((o) => o.label === answers[q.id]) ? "" : answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                  />
                </div>
              ))}
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => act("answers", { answers })}>
                  {busy ? "The panel is reviewing your answers…" : "Send answers"}
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => act("finish")}>
                  Use defaults and finish
                </button>
              </div>
            </>
          )}

          {view.phase === "done" && (
            <>
              <h2>The plan is ready</h2>
              <p className="muted">
                The panel reached {Math.round(view.confidence * 100)}% confidence. Check the plan on the right, then hand it to the build team.
              </p>
              {view.minutes.decisions.length > 0 && (
                <div className="stack">
                  <h3>Decisions you made</h3>
                  <ul className="small">{view.minutes.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              )}
              <div className="row">
                <button className="btn" disabled={busy} onClick={build}>
                  {busy ? "Starting the build…" : "Approve and build"}
                </button>
              </div>
            </>
          )}
        </section>

        <aside className="stack">
          <section className="card meter">
            <h2>Confidence</h2>
            <span className="big">{Math.round(view.confidence * 100)}%</span>
            <div className="bar"><span style={{ width: `${Math.round(view.confidence * 100)}%` }} /></div>
            <p className="muted small">The build starts at 80% with no blocking questions, or after 3 rounds.</p>
            {view.areaConfidence && (
              <div className="areas">
                {Object.entries(view.areaConfidence).map(([area, v]) => (
                  <div key={area} style={{ display: "contents" }}>
                    <span>{area}</span>
                    <div className="bar"><span style={{ width: `${Math.round(v * 100)}%` }} /></div>
                    <span className="n">{Math.round(v * 100)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {(reviewing || view.reviews.length > 0) && (
            <section className="card">
              <h2>Review panel</h2>
              <div className="members">
                {(reviewing && !view.reviews.length ? Object.keys(MEMBER_TITLES).map((role) => ({ role, model: "", summary: "", concerns: [], scores: {} } as unknown as MemberReview)) : view.reviews).map((r) => (
                  <div key={r.role} className={`member ${reviewing ? "thinking" : ""}`}>
                    <span className="who">{MEMBER_TITLES[r.role] ?? r.role}</span>
                    {r.model && <span className="model">{r.model}</span>}
                    {reviewing ? <span className="muted">Reviewing…</span> : r.error ? <span className="muted">Couldn't respond this round</span> : <span>{r.summary}</span>}
                    {!reviewing && r.concerns.length > 0 && (
                      <span className="chips">
                        {r.concerns.slice(0, 3).map((c, i) => (
                          <span key={i} className={`chip ${c.severity === "blocking" ? "bad" : c.severity === "important" ? "warn" : ""}`}>{c.area}</span>
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {view.blueprint.app.name && (
            <section className="card bp">
              <h2>Blueprint: {view.blueprint.app.name}</h2>
              <p className="muted small">{view.blueprint.app.summary}</p>
              <dl>
                <dt>Roles</dt><dd>{view.blueprint.roles.map((r) => r.name).join(", ") || "—"}</dd>
                <dt>Features</dt><dd>{view.blueprint.features.filter((f) => f.mvp).map((f) => f.name).join(", ") || "—"}</dd>
                <dt>Pages</dt><dd>{view.blueprint.pages.length}</dd>
                <dt>Data</dt><dd>{view.blueprint.entities.map((e) => e.name).join(", ") || "—"}</dd>
                <dt>API</dt><dd>{view.blueprint.endpoints.length} endpoints</dd>
                <dt>Login</dt><dd>{view.blueprint.auth.method || "—"}</dd>
                <dt>Payments</dt><dd>{view.blueprint.payments.mode || "—"}</dd>
              </dl>
              <details>
                <summary>Full Blueprint</summary>
                <pre>{JSON.stringify(view.blueprint, null, 2)}</pre>
              </details>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
