// What the AI parts are doing right now. lib/llm.ts reports every call here; the flow view listens.
export type Activity = {
  at: string;
  slot: string;
  part: string; // "provider:model"
  event: "start" | "done" | "switch" | "error";
  tokens?: number;
  ms?: number;
  detail?: string;
};

type Listener = (a: Activity) => void;
const g = globalThis as unknown as { __visionActivity?: { recent: Activity[]; listeners: Set<Listener>; tokens: Record<string, number> } };
const state = (g.__visionActivity ??= { recent: [], listeners: new Set(), tokens: {} });

export function report(a: Omit<Activity, "at">) {
  const entry = { ...a, at: new Date().toISOString() };
  state.recent.push(entry);
  if (state.recent.length > 300) state.recent.shift();
  if (a.event === "done" && a.tokens) state.tokens[a.part] = (state.tokens[a.part] ?? 0) + a.tokens;
  for (const l of state.listeners) l(entry);
}

export function onActivity(l: Listener) {
  state.listeners.add(l);
  return () => state.listeners.delete(l);
}

export const recentActivity = () => state.recent;
// Tokens each part has used since the server started
export const tokensUsed = () => state.tokens;
