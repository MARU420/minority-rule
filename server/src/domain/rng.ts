import { randomInt } from "node:crypto";

/** Deterministic PRNG (mulberry32) for tests. Production uses crypto. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;
export const cryptoRand: Rand = () => randomInt(0, 2 ** 31) / 2 ** 31;

/** Fisher-Yates shuffle. Caller chooses randomness source. */
export function shuffle<T>(arr: T[], rand: Rand = cryptoRand): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(arr: T[], rand: Rand = cryptoRand): T {
  return arr[Math.floor(rand() * arr.length)];
}
