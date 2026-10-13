import type { Player, Vote } from "./engine";

type Personality = "random" | "follower" | "contrarian";

/** Assign a fixed personality per bot id so behavior feels consistent. */
function personality(id: number): Personality {
  if (id % 3 === 0) return "random";
  if (id % 3 === 1) return "follower";
  return "contrarian";
}

/**
 * Bots vote without knowing your current vote.
 * - random: coin flip
 * - follower: leans toward last round's minority (bandwagon)
 * - contrarian: leans away from last round's minority (tries to be alone)
 */
export function botVote(bot: Player, lastMinority: Vote | null): Vote {
  const p = personality(bot.id);
  const r = Math.random();
  if (p === "random") return r < 0.5 ? "YES" : "NO";
  if (lastMinority === null) return r < 0.5 ? "YES" : "NO";
  if (p === "follower") return r < 0.7 ? lastMinority : lastMinority === "YES" ? "NO" : "YES";
  // contrarian
  const opposite: Vote = lastMinority === "YES" ? "NO" : "YES";
  return r < 0.6 ? opposite : lastMinority;
}
