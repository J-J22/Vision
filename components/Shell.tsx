"use client";
// The frame around every page: one slim bar (badge, the project's steps, AI parts) and a calm centered page
import Link from "next/link";
import type { ReactNode } from "react";
import { reached, STAGES, type ProjectView } from "./useProject";

export function Shell({ project, page, children }: { project: ProjectView | null; page: string; children: ReactNode }) {
  const furthest = project ? reached(project) : -1;
  const current = project ? STAGES.findIndex((s) => s.stage === project.stage) : -1;

  return (
    <div className="app">
      <header className="appbar">
        <Link href="/" className="eye-badge appbar-badge">VISION</Link>
        {project && (
          <nav className="steps" aria-label="Project steps">
            {STAGES.map((s, i) => {
              const href = s.stage === "build" ? (project.buildId ? `/build/${project.buildId}?project=${project.id}` : null) : `/p/${project.id}/${s.path}`;
              const state = i === current ? "now" : i <= furthest ? "done" : "";
              const body = (
                <>
                  <i />
                  <span>{s.name}</span>
                </>
              );
              return href && i <= Math.max(furthest, 0) ? (
                <Link key={s.stage} href={href} className={`step ${state} ${page === s.path ? "here" : ""}`}>{body}</Link>
              ) : (
                <span key={s.stage} className="step locked">{body}</span>
              );
            })}
          </nav>
        )}
        <Link href="/parts" className={`appbar-link ${page === "parts" ? "here" : ""}`}>AI parts</Link>
      </header>
      <main className="page">{children}</main>
    </div>
  );
}
