import type { Vote } from "./minority.js";
import type { Rand } from "./rng.js";
import { pick } from "./rng.js";

export type BotStrategy = "random" | "majority-predict" | "minority-seek" | "adaptive";
export type BotDifficulty = "easy" | "normal" | "sharp";

/** Public-only history available to bots AND humans. */
export interface PublicRoundSummary {
  yes: number;
  no: number;
  minority: Vote | null;
}

/**
 * Server-side bot vote. Inputs are strictly public info:
 * previous public totals, own history, question text, strategy/difficulty.
 * Never hidden votes, future questions, or private data.
 */
export function botChooseVote(opts: {
  strategy: BotStrategy;
  difficulty: BotDifficulty;
  history: PublicRoundSummary[];
  ownVotes: Vote[];
  rand: Rand;
}): Vote {
  const { strategy, difficulty, history, ownVotes, rand } = opts;
  const coin = () => (rand() < 0.5 ? "YES" : ("NO" as Vote));
  const skill = difficulty === "easy" ? 0.55 : difficulty === "normal" ? 0.65 : 0.75;

  if (strategy === "random" || history.length === 0) return coin();

  const last = history[history.length - 1];
  const lastMinority: Vote | null = last.minority;
  if (!lastMinority) return coin();

  switch (strategy) {
    case "majority-predict":
      // try to stand where others won't: take last minority with skill
      return rand() < skill ? lastMinority : coin();
    case "minority-seek": {
      // avoid own repetition, lean to last minority
      const lastOwn = ownVotes[ownVotes.length - 1];
      if (lastOwn === lastMinority && rand() < skill) return lastMinority === "YES" ? "NO" : "YES";
      return rand() < skill ? lastMinority : coin();
    }
    case "adaptive": {
      // count minority side frequency; fade to contrarian of the hot side
      let yesMin = 0;
      let noMin = 0;
      for (const h of history) {
        if (h.minority === "YES") yesMin++;
        else if (h.minority === "NO") noMin++;
      }
      const hot: Vote | null = yesMin === noMin ? lastMinority : yesMin > noMin ? "YES" : "NO";
      return rand() < skill ? (hot === "YES" ? "NO" : "YES") : coin();
    }
  }
}

/** Bot display names (never impersonate human accounts). */
const BOT_NAMES = ["Rook", "Vex", "Mira", "Kano", "Sable", "Onyx", "Pip", "Juno", "Ash", "Rune", "Zia", "Cole"];

export function botDisplayName(index: number): string {
  return `BOT·${BOT_NAMES[index % BOT_NAMES.length]}${index >= BOT_NAMES.length ? `-${Math.floor(index / BOT_NAMES.length) + 1}` : ""}`;
}

/** Pick a bank question not already used in this match. */
export function botPickQuestion(bank: string[], usedNormalized: Set<string>, rand: Rand): string {
  const fresh = bank.filter((q) => !usedNormalized.has(q.toLowerCase()));
  if (fresh.length > 0) return pick(fresh, rand);
  return pick(bank, rand);
}
