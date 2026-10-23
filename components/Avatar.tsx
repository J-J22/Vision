import { look } from "./agents";

export function Avatar({ who, size = "", speaking = false, dim = false }: { who: string; size?: "" | "sm" | "lg"; speaking?: boolean; dim?: boolean }) {
  const a = look(who);
  return (
    <span className={`avatar ${size} ${speaking ? "speaking" : ""} ${dim ? "dim" : ""}`} style={{ ["--c" as string]: a.color }} title={a.name} aria-label={a.name}>
      <span className="icon" aria-hidden="true">{a.icon}</span>
    </span>
  );
}

export function Typing() {
  return (
    <span className="typing" aria-label="typing">
      <i /><i /><i />
    </span>
  );
}
