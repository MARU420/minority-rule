import { describe, expect, it } from "vitest";
import { detectMinority } from "../src/domain/minority.js";
import { settleRound } from "../src/domain/economy.js";
import { sortLeaderboard } from "../src/domain/leaderboard.js";
import { checkQuestion, normalizeQuestion } from "../src/domain/questions.js";
import { botChooseVote } from "../src/domain/bots.js";
import { seededRng, shuffle } from "../src/domain/rng.js";
import { canTransition } from "../src/domain/states.js";
import { validateSettings } from "../src/domain/config.js";

describe("minority detection", () => {
  it("NO minority when YES majority", () => {
    expect(detectMinority(["YES", "YES", "YES", "NO"])).toEqual({ yes: 3, no: 1, minority: "NO" });
  });
  it("equal votes = tie", () => {
    expect(detectMinority(["YES", "YES", "NO", "NO"]).minority).toBeNull();
  });
  it("all YES = minority NO with zero voters (refund path)", () => {
    expect(detectMinority(["YES", "YES"]).minority).toBe("NO");
  });
  it("all NO", () => {
    expect(detectMinority(["NO", "NO", "NO"]).minority).toBe("YES");
  });
  it("single minority winner", () => {
    expect(detectMinority(["YES", "NO", "NO", "NO", "NO"]).minority).toBe("YES");
  });
});

describe("chip economy", () => {
  const bal = (n: number, v = 100) => new Map(Array.from({ length: n }, (_, i) => [`p${i}`, v]));

  it("6-player example: pot 60, 2 winners get 30", () => {
    const b = bal(6);
    const v2 = new Map([
      ["p0", "YES"],
      ["p1", "YES"],
      ["p2", "NO"],
      ["p3", "NO"],
      ["p4", "NO"],
      ["p5", "NO"],
    ] as const);
    const { settlement, newBalances } = settleRound("r", b, v2 as Map<string, "YES" | "NO">, 10, seededRng(1));
    expect(settlement.pot).toBe(60);
    expect(settlement.payouts).toHaveLength(2);
    expect(settlement.payouts.reduce((a, p) => a + p.gross, 0)).toBe(60);
    for (const p of settlement.payouts) expect(p.gross).toBe(30);
    expect(newBalances.get("p0")).toBe(120); // -10 +30
    expect(newBalances.get("p2")).toBe(90);
  });

  it("tie refunds everything, supply constant", () => {
    const b = bal(4);
    const v = new Map([["p0", "YES"], ["p1", "YES"], ["p2", "NO"], ["p3", "NO"]] as const);
    const before = [...b.values()].reduce((a, x) => a + x, 0);
    const { settlement, newBalances } = settleRound("r", b, v as never, 10, seededRng(2));
    expect(settlement.outcome.minority).toBeNull();
    expect(settlement.refunds).toHaveLength(4);
    expect([...newBalances.values()].reduce((a, x) => a + x, 0)).toBe(before);
  });

  it("remainder distributed deterministically (+1 each, recorded)", () => {
    // For remainder: balances with low funds → pot not divisible by winners:
    // 5 YES 1 NO → NO minority of 1... use 5v1? minority size 1. remainder test needs pot % winners != 0:
    // 6 players stake 10 → pot 60; 4 YES 2 NO → YES minority of... 4>2 so minority YES? no: yes=4,no=2 → minority NO (2 winners), 60/2=30 exact.
    // 5v... 5 YES 1 NO → minority NO 1 winner gets 60. For remainder: 7 players not possible here; use balances with low funds:
    const b2 = new Map([["a", 100], ["b", 100], ["c", 100], ["d", 5], ["e", 100]]);
    const v = new Map([["a", "YES"], ["b", "YES"], ["c", "YES"], ["d", "NO"], ["e", "NO"]] as const);
    // pot = 10*4+5 = 45; minority NO (2 winners) → 22 each +1 remainder to first
    const { settlement, newBalances } = settleRound("r", b2, v as never, 10, seededRng(3));
    expect(settlement.pot).toBe(45);
    const total = settlement.payouts.reduce((a, p) => a + p.gross, 0);
    expect(total).toBe(45);
    expect(settlement.remainderTo).toHaveLength(1);
    expect(newBalances.get("d")).toBe(5 - 5 + 22 + (settlement.remainderTo[0] === "d" ? 1 : 0));
  });

  it("zero-chip player votes free, can still win; no negatives", () => {
    const b = new Map([["a", 0], ["x", 100], ["y", 100]]);
    const v = new Map([["a", "YES"], ["x", "NO"], ["y", "NO"]] as const);
    const { settlement, newBalances } = settleRound("r", b, v as never, 10, seededRng(4));
    expect(settlement.pot).toBe(20);
    expect(newBalances.get("a")).toBe(20);
    for (const balV of newBalances.values()) expect(balV).toBeGreaterThanOrEqual(0);
  });

  it("supply conserved across 200 randomized rounds (property)", () => {
    const rand = seededRng(99);
    for (let t = 0; t < 200; t++) {
      const n = 3 + Math.floor(rand() * 8);
      const b = new Map(Array.from({ length: n }, (_, i) => [`p${i}`, Math.floor(rand() * 150)]));
      const v = new Map<string, "YES" | "NO">();
      for (let i = 0; i < n; i++) if (rand() < 0.9) v.set(`p${i}`, rand() < 0.5 ? "YES" : "NO");
      const before = [...b.values()].reduce((a, x) => a + x, 0);
      const { settlement, newBalances } = settleRound(`r${t}`, b, v, 10, rand);
      const after = [...newBalances.values()].reduce((a, x) => a + x, 0);
      expect(after).toBe(before);
      expect(settlement.pot).toBe(settlement.stakes.reduce((a, s) => a + s.staked, 0));
      for (const balV of newBalances.values()) expect(balV).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("leaderboard", () => {
  it("sorts balance > wins > payout > id, ties share rank", () => {
    const rows = sortLeaderboard([
      { participantId: "b", displayName: "b", kind: "HUMAN", balance: 100, net: 0, minorityWins: 5, roundsPlayed: 5, validVotes: 5, largestPayout: 10, tiesExperienced: 0 },
      { participantId: "a", displayName: "a", kind: "BOT", balance: 100, net: 0, minorityWins: 3, roundsPlayed: 5, validVotes: 5, largestPayout: 50, tiesExperienced: 0 },
      { participantId: "c", displayName: "c", kind: "HUMAN", balance: 120, net: 20, minorityWins: 0, roundsPlayed: 5, validVotes: 5, largestPayout: 0, tiesExperienced: 0 },
    ]);
    expect(rows.map((r) => r.participantId)).toEqual(["c", "b", "a"]);
  });
});

describe("questions", () => {
  it("rejects empty / too-long / non-string", () => {
    expect(checkQuestion("", 200).ok).toBe(false);
    expect(checkQuestion("   ", 200).ok).toBe(false);
    expect(checkQuestion("x".repeat(201), 200).ok).toBe(false);
    expect(checkQuestion(42, 200).ok).toBe(false);
  });
  it("accepts Arabic RTL + preserves display", () => {
    const t = "هل الكذب للفوز مقبول؟ (نعم/لا)";
    expect(checkQuestion(t, 200).ok).toBe(true);
    expect(normalizeQuestion("  Hello   WORLD ")).toBe("hello world");
  });
});

describe("bots use public info only", () => {
  it("deterministic with fixed seed", () => {
    const h = [{ yes: 4, no: 2, minority: "NO" as const }];
    const a = botChooseVote({ strategy: "adaptive", difficulty: "sharp", history: h, ownVotes: ["YES"], rand: seededRng(7) });
    const b = botChooseVote({ strategy: "adaptive", difficulty: "sharp", history: h, ownVotes: ["YES"], rand: seededRng(7) });
    expect(a).toBe(b);
  });
  it("all strategies return valid votes", () => {
    for (const s of ["random", "majority-predict", "minority-seek", "adaptive"] as const) {
      const v = botChooseVote({ strategy: s, difficulty: "normal", history: [{ yes: 5, no: 1, minority: "NO" }], ownVotes: [], rand: seededRng(1) });
      expect(["YES", "NO"]).toContain(v);
    }
  });
});

describe("state machine", () => {
  it("allows legal path, rejects skips", () => {
    expect(canTransition("WAITING_FOR_PLAYERS", "QUESTION_SUBMISSION")).toBe(true);
    expect(canTransition("WAITING_FOR_PLAYERS", "VOTING_OPEN")).toBe(false);
    expect(canTransition("VOTING_OPEN", "VOTING_LOCKED")).toBe(true);
    expect(canTransition("MATCH_COMPLETED", "VOTING_OPEN")).toBe(false);
  });
});

describe("config", () => {
  it("defaults match spec", () => {
    const s = validateSettings({});
    expect(s.startingBalance).toBe(100);
    expect(s.stake).toBe(10);
    expect(s.targetParticipants).toBe(6);
  });
  it("rejects min > target and client-injected junk", () => {
    expect(() => validateSettings({ minParticipants: 9, targetParticipants: 6 })).toThrow();
    expect(() => validateSettings({ stake: -5 })).toThrow();
  });
});

describe("shuffle", () => {
  it("keeps all N questions exactly once", () => {
    const order = shuffle(["a", "b", "c", "d", "e", "f"], seededRng(5));
    expect([...order].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
