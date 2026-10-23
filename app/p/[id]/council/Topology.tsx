"use client";
// Packet Tracer style map of the council: seats are devices cabled to the moderator hub, messages travel as packets
import { look, SEAT_ORDER } from "@/components/agents";
import type { CouncilMessage, CouncilRound } from "@/lib/types";
import s from "./council.module.css";

export const TYPE_COLOR: Record<string, string> = {
  claim: "var(--neon)",
  verify: "var(--green)",
  challenge: "var(--red)",
  concede: "var(--amber)",
  info: "var(--muted)",
};

const HUB = { x: 320, y: 215 };
const LEG = 0.8; // seconds per cable hop

export const POS: Record<string, { x: number; y: number }> = Object.fromEntries(
  SEAT_ORDER.map((seat, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return [seat, { x: Math.round(HUB.x + 240 * Math.cos(a)), y: Math.round(HUB.y + 158 * Math.sin(a)) }];
  }),
);

// Seats named in the message, else everyone but the sender
export function targets(m: CouncilMessage): string[] {
  const others = SEAT_ORDER.filter((x) => x !== m.from);
  if (m.from === "moderator") return [...SEAT_ORDER];
  const text = m.msg.toLowerCase();
  const named = others.filter((x) => text.includes(x) || text.includes(look(x).name.toLowerCase()));
  return named.length ? named : others;
}

function Packet({ from, to, delay, color }: { from: { x: number; y: number }; to: { x: number; y: number }; delay: number; color: string }) {
  const style = {
    "--x1": `${from.x}px`, "--y1": `${from.y}px`, "--x2": `${to.x}px`, "--y2": `${to.y}px`,
    animationDelay: `${delay}s`, animationDuration: `${LEG}s`,
  } as React.CSSProperties;
  return (
    <g className={s.packet} style={style}>
      <rect x={-9} y={-6} width={18} height={12} rx={2} fill={color} stroke="var(--sink)" strokeWidth={1.5} />
      <path d="M-9 -6 L0 1 L9 -6" fill="none" stroke="var(--sink)" strokeWidth={1.5} />
    </g>
  );
}

export function Topology({ r, pulse }: { r: CouncilRound; pulse: { m: CouncilMessage; key: number } | null }) {
  const last: Record<string, string> = {};
  for (const m of r.messages) if (m.from !== "moderator") last[m.from] = m.type;

  const pm = pulse?.m;
  const color = pm ? TYPE_COLOR[pm.type] : "";
  const fromHub = pm?.from === "moderator";
  const out = pm ? targets(pm) : [];
  const outDelay = fromHub ? 0 : LEG;

  return (
    <svg className={s.topo} viewBox="0 0 640 430" role="img" aria-label="Council network map">
      {SEAT_ORDER.map((seat) => {
        const p = POS[seat];
        const hot = pm && (pm.from === seat || out.includes(seat));
        return <line key={seat} x1={p.x} y1={p.y} x2={HUB.x} y2={HUB.y} className={`${s.cable} ${hot ? s.cableHot : ""}`} />;
      })}

      <g className={`${s.node} ${fromHub ? s.sending : ""}`}>
        <rect x={HUB.x - 75} y={HUB.y - 24} width={150} height={48} rx={6} className={s.hub} />
        <text x={HUB.x - 66} y={HUB.y + 10} className={`icon ${s.glyph}`} fill="var(--muted)">hub</text>
        <text x={HUB.x - 38} y={HUB.y - 3} className={s.hubName}>Moderator</text>
        <text x={HUB.x - 38} y={HUB.y + 11} className={s.sub}>Head of discussion</text>
      </g>

      {SEAT_ORDER.map((seat) => {
        const p = POS[seat];
        const a = look(seat);
        const speaking = r.speaking === seat;
        const sealed = r.sealed.includes(seat);
        return (
          <g key={seat} className={s.node} style={{ ["--c" as string]: a.color }}>
            {speaking && <circle cx={p.x} cy={p.y} r={40} className={s.ring} />}
            {pm && out.includes(seat) && (
              <rect key={pulse!.key} x={p.x - 38} y={p.y - 26} width={76} height={52} rx={8} className={s.recv}
                style={{ animationDelay: `${outDelay + LEG * 0.85}s`, ["--c" as string]: color }} />
            )}
            <rect x={p.x - 34} y={p.y - 22} width={68} height={44} rx={6} className={`${s.device} ${speaking ? s.deviceOn : ""}`} />
            <text x={p.x} y={p.y + 9} textAnchor="middle" className={`icon ${s.glyph}`} fill={a.color}>{a.icon}</text>
            {sealed && (
              <g>
                <circle cx={p.x + 32} cy={p.y - 20} r={10} fill="var(--sink)" stroke="var(--amber)" />
                <text x={p.x + 32} y={p.y - 13.5} textAnchor="middle" className={`icon ${s.badge}`} fill="var(--amber)">lock</text>
              </g>
            )}
            <text x={p.x} y={p.y + 38} textAnchor="middle" className={s.name}>{a.name}</text>
            <text x={p.x} y={p.y + 51} textAnchor="middle" className={s.sub} fill={last[seat] ? TYPE_COLOR[last[seat]] : undefined}>
              {speaking ? "transmitting" : sealed ? "sealed" : last[seat] ?? "idle"}
            </text>
          </g>
        );
      })}

      {pm && (
        <g key={pulse!.key}>
          {!fromHub && POS[pm.from] && <Packet from={POS[pm.from]} to={HUB} delay={0} color={color} />}
          {out.map((seat) => <Packet key={seat} from={HUB} to={POS[seat]} delay={outDelay} color={color} />)}
        </g>
      )}
    </svg>
  );
}
