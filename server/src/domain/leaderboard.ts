export interface LeaderboardRow {
  participantId: string;
  displayName: string;
  kind: "HUMAN" | "BOT";
  balance: number;
  net: number;
  minorityWins: number;
  roundsPlayed: number;
  validVotes: number;
  largestPayout: number;
  tiesExperienced: number;
}

/** Sort: balance desc, minorityWins desc, largestPayout desc, participantId asc (deterministic). */
export function sortLeaderboard(rows: LeaderboardRow[]): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) =>
      b.balance - a.balance ||
      b.minorityWins - a.minorityWins ||
      b.largestPayout - a.largestPayout ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  );
}
