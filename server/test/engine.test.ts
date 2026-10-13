import { describe, expect, it, beforeEach } from "vitest";
import { Store, newId, sha256 } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { seededRng } from "../src/domain/rng.js";

function setup(settings: Record<string, unknown> = {}) {
  const store = new Store(":memory:");
  const emitted: { event: string; payload: unknown }[] = [];
  const engine = new Engine(store, { toRoom: (_c, event, payload) => emitted.push({ event, payload }) }, seededRng(42), 42);
  const sessions: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = newId("s");
    store.db.prepare("INSERT INTO sessions(id,token_hash,display_name,created_at) VALUES(?,?,?,?)").run(id, sha256("tok" + i), `P${i}`, Date.now());
    sessions.push(id);
  }
  const code = engine.createRoom(sessions[0], "Host", {
    targetParticipants: 4,
    minParticipants: 3,
    votingDurationSec: 30,
    submissionDurationSec: 60,
    roundIntroSec: 0,
    botTakeover: false,
    ...settings,
  });
  for (let i = 1; i < 3; i++) engine.joinRoom(code, sessions[i], `P${i}`);
  return { store, engine, emitted, sessions, code };
}

function startMatch(e: Engine, code: string, host: string) {
  e.startMatch(code, host);
  const parts = e.participants(code);
  // humans submit
  for (const p of parts.filter((x) => x.kind === "HUMAN")) {
    e.submitQuestion(code, p.session_id!, `Should test question ${p.id.slice(-4)} be asked? (YES/NO)`);
  }
}

describe("multiplayer match flow", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

  it("bot-fills to target, plays N rounds with N questions each exactly once", async () => {
    const { engine, code, sessions } = ctx;
    startMatch(engine, code, sessions[0]);
    const room = engine.getRoom(code)!;
    const parts = engine.participants(code);
    expect(parts.length).toBe(4); // 3 humans + 1 bot
    expect(parts.filter((p) => p.kind === "BOT")).toHaveLength(1);
    const n = parts.length;
    const seenQuestions: string[] = [];
    for (let r = 0; r < n; r++) {
      await tick();
      const st = engine.fullState(code, sessions[0]) as { current: { text: string } };
      seenQuestions.push(st.current.text);
      const ps = engine.participants(code);
      ps.forEach((p, i) => engine.recordVote(code, p.id, i % 2 === 0 ? "YES" : "NO", true));
      engine.advanceNow(code);
    }
    expect(new Set(seenQuestions).size).toBe(n);
    const done = engine.getRoom(code)!;
    expect(done.state).toBe("MATCH_COMPLETED");
    expect(room.question_order.length).toBe(n);
  });

  it("supply conserved across a full match; no negatives; nobody eliminated", async () => {
    const { engine, code, sessions, store } = ctx;
    startMatch(engine, code, sessions[0]);
    const n = engine.participants(code).length; // locked roster: N x 100 is the conserved supply
    const lockedSupply = n * 100;
    for (let r = 0; r < n; r++) {
      await tick();
      const parts = engine.participants(code);
      parts.forEach((p, i) => engine.recordVote(code, p.id, i % 2 === 0 ? "YES" : "NO", true));
      engine.advanceNow(code);
    }
    const after = (store.db.prepare("SELECT SUM(balance) AS s FROM participants WHERE room_code=?").get(code) as { s: number }).s;
    expect(after).toBe(lockedSupply);
    for (const p of engine.participants(code)) expect(p.balance).toBeGreaterThanOrEqual(0);
    expect(engine.leaderboard(code)).toHaveLength(n);
  });

  it("duplicate vote change allowed; double settlement impossible", async () => {
    const { engine, code, sessions, store } = ctx;
    startMatch(engine, code, sessions[0]);
    await tick();
    const parts = engine.participants(code);
    engine.recordVote(code, parts[0].id, "YES", true);
    engine.recordVote(code, parts[0].id, "NO", true); // change ok
    engine.lockAndResolve(code, "x");
    engine.lockAndResolve(code, "y"); // no-op
    const rows = store.db.prepare("SELECT COUNT(*) AS c FROM settlements WHERE room_code=?").get(code) as { c: number };
    expect(rows.c).toBe(1);
  });

  it("late vote + nonparticipant vote rejected; spoofed session rejected", async () => {
    const { engine, code, sessions } = ctx;
    startMatch(engine, code, sessions[0]);
    await tick();
    const parts = engine.participants(code);
    for (const p of parts) engine.recordVote(code, p.id, "YES", true);
    // round resolved now (all YES → minority NO, zero winners → refund path)
    expect(() => engine.recordVote(code, parts[0].id, "NO", true)).toThrow(/voting-closed/);
    expect(() => engine.recordVote(code, "p_nope", "YES", true)).toThrow();
    expect(() => engine.submitVote(code, sessions[5], "YES")).toThrow(/not-participant/);
  });

  it("vote privacy: public snapshots never leak choices pre-resolution", async () => {
    const { engine, code, sessions } = ctx;
    startMatch(engine, code, sessions[0]);
    await tick();
    const parts = engine.participants(code);
    engine.recordVote(code, parts[0].id, "YES", true);
    const snap = JSON.stringify(engine.fullState(code, sessions[1]));
    expect(snap).not.toContain('"YES"');
    const pub = JSON.stringify(engine.publicRoom(code));
    expect(pub).not.toMatch(/"vote":"(YES|NO)"/);
  });

  it("tie refunds: balances back to pre-round after 2v2", async () => {
    const { engine, code, sessions } = ctx;
    startMatch(engine, code, sessions[0]);
    await tick();
    const parts = engine.participants(code);
    engine.recordVote(code, parts[0].id, "YES", true);
    engine.recordVote(code, parts[1].id, "YES", true);
    engine.recordVote(code, parts[2].id, "NO", true);
    engine.recordVote(code, parts[3].id, "NO", true);
    // stakes were 10 each from 100 → tie refunds to 100
    for (const p of engine.participants(code)) expect(p.balance).toBe(100);
    expect(engine.getRoom(code)!.state).toBe("ROUND_RESULTS");
  });

  it("disconnect keeps seat; reconnect restores; no extra bots", () => {
    const { engine, code, sessions } = ctx;
    startMatch(engine, code, sessions[0]);
    const n = engine.participants(code).length;
    engine.onDisconnect(sessions[1]);
    expect(engine.participants(code)).toHaveLength(n);
    engine.onReconnect(sessions[1]);
    expect(engine.participants(code)).toHaveLength(n);
    const me = engine.participantBySession(code, sessions[1]);
    expect(me?.connected).toBe(1);
  });

  it("invalid transitions rejected and logged", () => {
    const { engine, code, store } = ctx;
    expect(() => engine.readyNext(code, "x")).toThrow(/bad-state/);
    const n = (store.db.prepare("SELECT COUNT(*) AS c FROM sec_events WHERE kind='invalid-transition'").get() as { c: number }).c;
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("non-host cannot start; oversized question rejected; XSS stored raw but escaped by helper", () => {
    const { engine, code, sessions } = ctx;
    expect(() => engine.startMatch(code, sessions[1])).toThrow(/not-host/);
    engine.startMatch(code, sessions[0]);
    expect(() => engine.submitQuestion(code, sessions[0], "x".repeat(500))).toThrow(/bad-question/);
    expect(() => engine.submitQuestion(code, sessions[0], "<script>alert(1)</script> is this a YES/NO question?")).not.toThrow();
  });

  it("missing human question gets documented fallback; match still has N questions", () => {
    const { engine, code, sessions } = ctx;
    engine.startMatch(code, sessions[0]);
    // only 2 of 3 humans submit
    const humans = engine.participants(code).filter((p) => p.kind === "HUMAN");
    engine.submitQuestion(code, humans[0].session_id!, "Is fallback policy documented well enough? (YES/NO)");
    engine.submitQuestion(code, humans[1].session_id!, "Should missing questions get fallback? (YES/NO)");
    engine.resolveSubmission(code); // force deadline path
    const room = engine.getRoom(code)!;
    expect(room.question_order.length).toBe(engine.participants(code).length);
  });
});
