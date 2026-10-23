"use client";
// The frame around every project page: stage directory on the left (future stages locked), status bar on top
import Link from "next/link";
import type { ReactNode } from "react";
import { look, SEAT_ORDER } from "./agents";
import { reached, STAGES, type ProjectView } from "./useProject";

export function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="mark"><span className="icon">visibility</span></span>
      <span className="stack" style={{ gap: 0 }}>
        <b>VISION</b>
        <span className="ver">// AI build council</span>
      </span>
    </Link>
  );
}

export function Shell({ project, page, children }: { project: ProjectView | null; page: string; children: ReactNode }) {
  const furthest = project ? reached(project) : -1;
  const round = project?.rounds.at(-1);
  const confidence = round?.status === "done" ? Math.round(round.confidence * 100) : null;
  const stageName = project ? STAGES.find((s) => s.stage === project.stage)?.name : "";

  return (
    <div className="shell scanlines">
      <aside className="side">
        <Brand />
        <nav className="dir" aria-label="Project stages">
          <span className="label">// Runtime directory</span>
          <Link href="/" className={page === "home" ? "active" : ""}>
            <span><span className="tag">[INIT]</span>New project</span>
          </Link>
          {STAGES.map((s, i) => {
            const open = project && (i <= furthest || (s.stage === "discovery"));
            const href = s.stage === "build" ? (project?.buildId ? `/build/${project.buildId}?project=${project.id}` : "#") : `/p/${project?.id}/${s.path}`;
            return open && (s.stage !== "build" || project?.buildId) ? (
              <Link key={s.stage} href={href} className={page === s.path ? "active" : ""}>
                <span><span className="tag">{s.tag}</span>{s.name}</span>
                {project?.stage === s.stage && <span className="led" />}
              </Link>
            ) : (
              <span key={s.stage} className="locked" title="Finish the earlier stages first">
                <span><span className="tag">{s.tag}</span>{s.name}</span>
                <span className="icon" style={{ fontSize: 15 }}>lock</span>
              </span>
            );
          })}
          <span className="label" style={{ marginTop: 14 }}>// Assembly</span>
          <Link href="/parts" className={page === "parts" ? "active" : ""}>
            <span><span className="tag">[PART]</span>AI parts</span>
          </Link>
        </nav>
        <div className="foot stack" style={{ gap: 6 }}>
          <span className="label">Models</span>
          <Link href="/parts" className="small">Choose which AI runs each step →</Link>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="proj">{project ? `PRJ-${project.id.toUpperCase()} // ${project.blueprint.app.name || "untitled"}` : "VISION"}</span>
          {stageName && <span className="stage-badge">Stage: {stageName}</span>}
          <span className="seats-strip">
            {SEAT_ORDER.map((s) => (
              <span key={s}>
                <i className={`led ${round?.speaking === s ? "" : round?.status === "running" ? "amber" : project?.rounds.length ? "" : "off"}`} />
                {look(s).name}
              </span>
            ))}
          </span>
          {confidence !== null && <span className="conf">Confidence: {confidence}%</span>}
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
