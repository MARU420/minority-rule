import type { Player } from "../game/engine";

export function SuitPortrait({ id }: { id: number }) {
  const v = id % 10;
  const tie = v === 0 || v === 3 || v === 7 ? "#E10600" : "#0A0A0A";
  const hair: Record<number, string> = {
    0: "M18 22 C18 10 46 10 46 22 L44 18 C38 12 26 12 20 18 Z", // slick back (YOU)
    1: "M20 20 L20 12 L44 12 L44 20 C40 15 24 15 20 20 Z", // buzz / flat top
    2: "M18 24 C16 10 48 10 46 24 C42 16 22 16 18 24 Z", // side part
    3: "M16 34 C14 10 50 10 48 34 L44 34 C46 20 42 14 32 14 C22 14 18 20 20 34 Z", // long
    4: "M22 14 C26 12 38 12 42 14 L42 12 L22 12 Z", // bald
    5: "M18 22 C14 8 50 8 46 22 L42 16 C40 22 24 22 22 16 Z", // messy
    6: "M18 24 L18 10 L46 10 L46 24 L42 14 L22 14 Z", // square
    7: "M18 22 C18 8 46 8 46 22 L30 14 L20 20 Z", // swept
    8: "M20 22 C20 12 44 12 44 22 L44 18 L20 18 Z", // short
    9: "M16 26 C12 8 52 8 48 26 C44 14 20 14 16 26 Z", // wild
  };
  const glasses = v === 2 || v === 6 || v === 9;

  return (
    <svg viewBox="0 0 64 64" className="h-20 w-20">
      {/* shoulders / suit */}
      <path d="M6 64 C8 48 20 42 32 42 C44 42 56 48 58 64 Z" fill="#0A0A0A" />
      {/* shirt */}
      <path d="M26 42 L32 56 L38 42 L36 42 L32 50 L28 42 Z" fill="#fff" />
      {/* tie */}
      <path d="M30 44 L34 44 L33 54 L32 57 L31 54 Z" fill={tie} />
      {/* neck */}
      <rect x="27" y="32" width="10" height="10" fill="#fff" stroke="#0A0A0A" strokeWidth="2.5" />
      {/* head */}
      <ellipse cx="32" cy="22" rx="12" ry="13" fill="#fff" stroke="#0A0A0A" strokeWidth="3" />
      {/* hair */}
      <path d={hair[v]} fill="#0A0A0A" />
      {/* eyes */}
      <line x1="24" y1="23" x2="28" y2="23" stroke="#0A0A0A" strokeWidth="2.5" />
      <line x1="36" y1="23" x2="40" y2="23" stroke="#0A0A0A" strokeWidth="2.5" />
      {glasses && (
        <g stroke="#0A0A0A" strokeWidth="2" fill="none">
          <rect x="22" y="19" width="9" height="8" />
          <rect x="33" y="19" width="9" height="8" />
          <line x1="31" y1="22" x2="33" y2="22" />
        </g>
      )}
      {/* mouth: smirk varies */}
      {v % 2 === 0 ? (
        <path d="M27 30 L37 30" stroke={v === 0 ? "#E10600" : "#0A0A0A"} strokeWidth="2.5" />
      ) : (
        <path d="M27 30 L37 28" stroke="#0A0A0A" strokeWidth="2.5" />
      )}
    </svg>
  );
}

export function PlayerCard({ player, reveal }: { player: Player; reveal: boolean }) {
  const voteLabel = !player.vote ? "—" : !reveal ? "● ● ●" : player.vote;
  const voteCls =
    !player.vote || !reveal
      ? "bg-[#0A0A0A] text-white"
      : player.vote === "YES"
        ? "bg-white text-black"
        : "bg-[#E10600] text-white";

  return (
    <div className={`ticket bg-white text-[#0A0A0A] ${player.isYou ? "ticket-you" : ""} ${player.eliminated ? "opacity-50 grayscale" : ""}`}>
      <div className="halftone-dark relative flex h-28 items-center justify-center border-b-[3px] border-black">
        <span className="skew-tag absolute top-1.5 left-1.5 border-2 border-black bg-[#0A0A0A] px-2 py-0.5 text-[11px] font-black text-white">
          #{String(player.id).padStart(2, "0")}
        </span>
        {player.isYou && (
          <span className="skew-tag absolute top-1.5 right-1.5 border-2 border-black bg-[#E10600] px-2 py-0.5 text-[11px] font-black text-white">
            YOU
          </span>
        )}
        <SuitPortrait id={player.id} />
      </div>
      <div className="p-2">
        <b className="block text-[13px]">{player.name}</b>
        <div className="text-[12px] font-black">{player.coins >= 0 ? `+${player.coins}` : player.coins}</div>
        <div className={`mt-2 border-[3px] border-black p-1.5 text-center font-display text-sm tracking-wider ${voteCls}`}>
          {player.eliminated ? "✕ OUT" : voteLabel}
        </div>
      </div>
    </div>
  );
}
