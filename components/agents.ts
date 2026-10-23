// How each agent looks: its "logo" (a Material Symbols icon), color and role line
export type AgentLook = { name: string; icon: string; color: string; role: string };

export const AGENTS: Record<string, AgentLook> = {
  vision: { name: "Vision", icon: "visibility", color: "var(--neon)", role: "Interviewer" },
  architect: { name: "Architect", icon: "account_tree", color: "var(--neon)", role: "Data, API, scale" },
  product: { name: "Product lead", icon: "person_search", color: "var(--green)", role: "Users, features, journeys" },
  security: { name: "Security", icon: "shield_lock", color: "var(--amber)", role: "Login, permissions, money" },
  skeptic: { name: "Skeptic", icon: "gavel", color: "var(--red)", role: "Contradictions, edge cases" },
  designer: { name: "Designer", icon: "palette", color: "var(--cyan)", role: "Screens, flow, look" },
  moderator: { name: "Moderator", icon: "balance", color: "var(--muted)", role: "Runs the debate" },
  user: { name: "You", icon: "person", color: "var(--violet)", role: "" },
};

export const SEAT_ORDER = ["architect", "product", "security", "skeptic", "designer"] as const;

export const look = (who: string): AgentLook => AGENTS[who] ?? { name: who, icon: "smart_toy", color: "var(--muted)", role: "" };
