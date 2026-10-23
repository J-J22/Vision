"use client";
// Landing: the team's pixel eye hero. The input is box 1 of the flow: the user's idea starts a project
// and goes straight to the Discovery room.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PixelEye } from "@/components/PixelEye";

// Ideas you can click to fill the input
const EXAMPLES = ["A marketplace for second-hand laptops", "A portfolio site for my projects", "A booking app for a hair salon", "A habit tracker with a dashboard"];

export default function Home() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const idea = value.trim();
    if (!idea || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idea }) });
      const p = await r.json();
      if (!p.id) throw new Error(p.error ?? "no project");
      router.push(`/p/${p.id}/discovery`);
    } catch {
      setError("Couldn't start your project. Is Vision running?");
      setBusy(false);
    }
  }

  return (
    <section className="eye-hero">
      {/* WebGL layer */}
      <PixelEye className="eye-layer" />

      {/* CRT scanlines (pure CSS, zero GPU cost) */}
      <div aria-hidden="true" className="eye-scan" />

      {/* top bar */}
      <header className="eye-top">
        <h1 className="eye-badge">VISION</h1>
        <a className="eye-btn" href="/parts">AI parts</a>
      </header>

      {/* input */}
      <div className="eye-ask">
        <p className="eye-label">What do you want to build?</p>
        <form onSubmit={handleSubmit} className="eye-form">
          <label htmlFor="vision-input" className="sr-only">
            Describe the app you want to build
          </label>
          <input
            id="vision-input"
            name="vision"
            type="text"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Describe the app you want to build"
            disabled={busy}
          />
          <button type="submit" className="eye-btn" disabled={busy || !value.trim()}>
            {busy ? "..." : "Build →"}
          </button>
        </form>
        <div className="eye-examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="eye-chip" onClick={() => setValue(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
        {error && <p className="eye-hint" style={{ color: "var(--red)" }}>{error}</p>}
      </div>
    </section>
  );
}
