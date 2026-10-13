export interface NetParticipant {
  id: string;
  name: string;
  kind: "HUMAN" | "BOT";
  connected: boolean;
  ready: boolean;
  submitted: boolean;
}

export interface NetSettings {
  targetParticipants: number;
  minParticipants: number;
  maxParticipants: number;
  stake: number;
  startingBalance: number;
  votingDurationSec: number;
  submissionDurationSec: number;
  revealAuthorship: boolean;
}

export interface NetLeaderRow {
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

export interface PublicRoom {
  code: string;
  state: string;
  round: number;
  totalRounds: number;
  deadlineMs: number | null;
  participants: NetParticipant[];
  submitted: number;
  total: number;
  settings: NetSettings;
  leaderboard: NetLeaderRow[];
}
