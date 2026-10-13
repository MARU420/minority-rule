export interface RoundQuestion {
  text: string;
  sub: string;
}

export const ROUND_QUESTIONS: RoundQuestion[] = [
  {
    text: "Should all winnings be split equally, no matter how you voted?",
    sub: "Round 1 — the fairness trap. Say YES and look soft. Say NO and look greedy.",
  },
  {
    text: "Is lying to win this game acceptable?",
    sub: "Round 2 — the honesty test. Everyone lies here. The vote says who admits it.",
  },
  {
    text: "Should the current leader be targeted by the whole table?",
    sub: "Round 3 — the king-killer. YES bands the weak. NO protects the strong.",
  },
  {
    text: "Would you betray your closest ally here for double the pot?",
    sub: "Round 4 — the knife question. Stakes are 300. Alliances crack here.",
  },
  {
    text: "Should the final pot go to ONE winner instead of being shared?",
    sub: "Final — winner-takes-all. Stakes 500. Vote your true nature.",
  },
];

export function questionForRound(round: number): RoundQuestion {
  return ROUND_QUESTIONS[Math.min(Math.max(round, 1), ROUND_QUESTIONS.length) - 1];
}

/** Bots pitch their own questions in multiplayer-style submit phase. */
export const BOT_QUESTION_POOL: string[] = [
  "Should the poorest player get immunity this round?",
  "Is it smart to always vote against the crowd?",
  "Should anyone who lies be punished double?",
  "Is teamwork just a trap for the naive?",
  "Should the leader have to reveal their vote first?",
  "Is betrayal the only real strategy?",
  "Should ties punish EVERYONE instead of a revote?",
  "Is silence more suspicious than bluffing?",
  "Should winners split with the losers out of pity?",
  "Is this table full of cowards?",
];

export function randomBotQuestions(n: number): string[] {
  return [...BOT_QUESTION_POOL].sort(() => Math.random() - 0.5).slice(0, n);
}
