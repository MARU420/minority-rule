export type Vote = "YES" | "NO";

export interface Player {
  id: number;
  name: string;
  isYou: boolean;
  coins: number;
  vote: Vote | null;
  eliminated: boolean;
  face: number;
}

export type Phase = "submit" | "talk" | "vote" | "reveal" | "gameover";

export const TOTAL_ROUNDS = 5;
export const PLAYERS_COUNT = 10;

export function createPlayers(): Player[] {
  return Array.from({ length: PLAYERS_COUNT }, (_, i) => ({
    id: i,
    name: i === 0 ? "YOU" : `BOT ${String(i).padStart(2, "0")}`,
    isYou: i === 0,
    coins: 0,
    vote: null,
    eliminated: false,
    face: i,
  }));
}

export interface RoundResult {
  yesCount: number;
  noCount: number;
  minority: Vote | null; // null = tie -> sudden death revote
  winners: number[];
  stake: number;
}

/** Rising stakes per round: tension ramps. */
export const STAKES = [100, 150, 200, 300, 500];

export function stakeForRound(round: number): number {
  return STAKES[Math.min(Math.max(round, 1), STAKES.length) - 1];
}

/** Payout: each majority player pays `stake`, split evenly among minority winners. Tie = no payout, sudden-death revote. */
export function resolveRound(players: Player[], round: number): { players: Player[]; result: RoundResult } {
  const stake = stakeForRound(round);
  const yesCount = players.filter((p) => p.vote === "YES").length;
  const noCount = players.filter((p) => p.vote === "NO").length;

  if (yesCount === noCount) {
    return { players: players.map((p) => ({ ...p })), result: { yesCount, noCount, minority: null, winners: [], stake } };
  }

  const minority: Vote = yesCount < noCount ? "YES" : "NO";
  const winners = players.filter((p) => p.vote === minority).map((p) => p.id);
  const losers = players.filter((p) => p.vote !== minority);
  const pot = losers.length * stake;
  const share = Math.floor(pot / winners.length);

  const next = players.map((p) => {
    if (p.vote === minority) return { ...p, coins: p.coins + share };
    return { ...p, coins: p.coins - stake };
  });

  return { players: next, result: { yesCount, noCount, minority, winners, stake } };
}
