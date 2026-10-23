"use client";
// Loads a project and keeps it live through the events stream; `act` sends an action
import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, CouncilRound, Stage, UserQuestion, Blueprint, Minutes } from "@/lib/types";
import type { Facts } from "@/lib/agents/intake";

export type ProjectView = {
  id: string;
  stage: Stage;
  chat: ChatMessage[];
  facts: Facts;
  intakeDone: boolean;
  blueprint: Blueprint;
  rounds: CouncilRound[];
  queue: UserQuestion[];
  queueIndex: number;
  current?: UserQuestion;
  questionNumber: number;
  questionTotal: number;
  asked: { area: string; question: string; answer: string }[];
  minutes: Minutes;
  masterPrompt?: string;
  buildId?: string;
  busy?: string;
  error?: string;
};

export function useProject(id: string) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let source: EventSource | null = null;
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setProblem(d.error);
        setProject(d);
        source = new EventSource(`/api/projects/${id}/events`);
        source.onmessage = (e) => setProject(JSON.parse(e.data));
        source.onerror = () => setProblem("Lost the live connection. It reconnects automatically; refresh if this stays.");
        source.onopen = () => setProblem("");
      })
      .catch(() => setProblem("Couldn't reach Vision. Is `npm run dev` running?"));
    return () => source?.close();
  }, [id]);

  const act = useCallback(
    async (action: string, payload?: object) => {
      const r = await fetch(`/api/projects/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload }) });
      const d = await r.json();
      if (d.error) {
        setProblem(d.error);
        return false;
      }
      setProblem("");
      setProject(d);
      return true;
    },
    [id],
  );

  return { project, problem, act };
}

export const STAGES: { stage: Stage; tag: string; name: string; path: string }[] = [
  { stage: "discovery", tag: "[DISC]", name: "Discovery", path: "discovery" },
  { stage: "council", tag: "[CNCL]", name: "Council", path: "council" },
  { stage: "master", tag: "[SPEC]", name: "Plan", path: "master" },
  { stage: "build", tag: "[SDLC]", name: "Build", path: "build" },
];

// The furthest stage this project has reached (discovery repeats between council rounds)
export function reached(p: ProjectView): number {
  if (p.stage === "build") return 3;
  if (p.stage === "master") return 2;
  if (p.rounds.length) return 1;
  return 0;
}
