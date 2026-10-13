export interface HistoryPoint {
  round: number;
  balances: Record<string, number>;
}

/** Minimal SVG chip-history chart — no chart lib needed. */
export function ChipGraph({
  history,
  names,
  meId,
}: {
  history: HistoryPoint[];
  names: Record<string, string>;
  meId: string | null;
}) {
  if (history.length < 2) return null;
  const W = 600;
  const H = 150;
  const PAD = 26;
  const ids = Object.keys(names);
  const all = history.flatMap((h) => Object.values(h.balances));
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1, max - min);
  const rounds = history.length - 1;
  const x = (i: number) => PAD + (i / Math.max(1, rounds)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.5, 1].map((t) => {
        const v = Math.round(min + span * t);
        return (
          <g key={t}>
            <line x1={PAD} y1={y(min + span * t)} x2={W - PAD} y2={y(min + span * t)} stroke="#000" strokeOpacity="0.15" strokeWidth="1" />
            <text x={2} y={y(min + span * t) + 4} fontSize="10" fontWeight="900">{v}</text>
          </g>
        );
      })}
      {ids.map((pid) => {
        const pts = history.map((h, i) => `${x(i)},${y(h.balances[pid] ?? min)}`).join(" ");
        const isMe = pid === meId;
        return (
          <g key={pid}>
            <polyline points={pts} fill="none" stroke={isMe ? "#E10600" : "#0A0A0A"} strokeOpacity={isMe ? 1 : 0.35} strokeWidth={isMe ? 3.5 : 1.5} />
            {history.map((h, i) => (
              <circle key={i} cx={x(i)} cy={y(h.balances[pid] ?? min)} r={isMe ? 3.5 : 2} fill={isMe ? "#E10600" : "#0A0A0A"} fillOpacity={isMe ? 1 : 0.4} />
            ))}
          </g>
        );
      })}
      {history.map((h, i) => (
        <text key={h.round} x={x(i)} y={H - 8} fontSize="10" fontWeight="900" textAnchor="middle">R{h.round}</text>
      ))}
      {meId && names[meId] && (
        <text x={W - PAD} y={14} fontSize="11" fontWeight="900" fill="#E10600" textAnchor="end">YOU · {names[meId]}</text>
      )}
    </svg>
  );
}
