import { detectMinority, type Vote } from "./minority.js";
import type { Rand } from "./rng.js";
import { shuffle } from "./rng.js";

export interface StakeEntry {
  participantId: string;
  /** actual chips taken (min(stake, balance)) */
  staked: number;
}

export interface PayoutEntry {
  participantId: string;
  gross: number;
}

export interface Settlement {
  roundId: string;
  pot: number;
  stakes: StakeEntry[];
  outcome: { yes: number; no: number; minority: Vote | null };
  /** tie → every contributor refunded in full */
  refunds: StakeEntry[];
  payouts: PayoutEntry[];
  /** remainder chips (+1) assigned to these winner ids, deterministic order */
  remainderTo: string[];
}

/**
 * Authoritative round settlement. Integer arithmetic only.
 * Invariants: no negative balances (caller clamps stake), pot == sum(stakes),
 * supply conserved (payouts+refunds == pot), idempotent by roundId (store-level).
 */
export function settleRound(
  roundId: string,
  balances: Map<string, number>,
  votes: Map<string, Vote>,
  stake: number,
  rand: Rand,
): { settlement: Settlement; newBalances: Map<string, number> } {
  const stakes: StakeEntry[] = [];
  let pot = 0;
  for (const [pid, bal] of balances) {
    const staked = Math.max(0, Math.min(stake, Math.floor(bal)));
    stakes.push({ participantId: pid, staked });
    pot += staked;
  }

  const validVotes: Vote[] = [];
  const voterIds: string[] = [];
  for (const [pid, v] of votes) {
    if (v === "YES" || v === "NO") {
      validVotes.push(v);
      voterIds.push(pid);
    }
  }
  const outcome = detectMinority(validVotes);

  const next = new Map(balances);
  for (const s of stakes) next.set(s.participantId, (next.get(s.participantId) ?? 0) - s.staked);

  if (outcome.minority === null) {
    // tie: full refunds, nothing created or destroyed
    for (const s of stakes) next.set(s.participantId, (next.get(s.participantId) ?? 0) + s.staked);
    return {
      settlement: { roundId, pot, stakes, outcome, refunds: [...stakes], payouts: [], remainderTo: [] },
      newBalances: next,
    };
  }

  const winners = voterIds.filter((pid) => votes.get(pid) === outcome.minority);
  if (winners.length === 0) {
    // no valid minority voters (e.g. all abstained): refund like a tie
    for (const s of stakes) next.set(s.participantId, (next.get(s.participantId) ?? 0) + s.staked);
    return {
      settlement: { roundId, pot, stakes, outcome, refunds: [...stakes], payouts: [], remainderTo: [] },
      newBalances: next,
    };
  }

  const ordered = shuffle(winners, rand);
  const base = Math.floor(pot / ordered.length);
  const remainder = pot - base * ordered.length;
  const payouts: PayoutEntry[] = ordered.map((pid, i) => ({ participantId: pid, gross: base + (i < remainder ? 1 : 0) }));
  const remainderTo = ordered.slice(0, remainder);
  for (const p of payouts) next.set(p.participantId, (next.get(p.participantId) ?? 0) + p.gross);

  return {
    settlement: { roundId, pot, stakes, outcome, refunds: [], payouts, remainderTo },
    newBalances: next,
  };
}
