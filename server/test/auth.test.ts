import { describe, expect, it } from "vitest";
import { Store, newId, sha256 } from "../src/store.js";
import { Engine } from "../src/engine.js";
import { checkCaptcha, deleteAccount, hashPassword, issueCaptcha, linkSession, loginUser, profileOf, registerUser, verifyPassword } from "../src/auth.js";
import { seededRng } from "../src/domain/rng.js";

function engineWithUsers() {
  const store = new Store(":memory:");
  const emitted: unknown[] = [];
  const engine = new Engine(store, { toRoom: () => emitted.push(1) }, seededRng(7), 7);
  const sessions: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = newId("s");
    store.db.prepare("INSERT INTO sessions(id,token_hash,display_name,created_at) VALUES(?,?,?,?)").run(id, sha256("t" + i), `P${i}`, Date.now());
    sessions.push(id);
  }
  return { store, engine, sessions };
}

describe("password auth", () => {
  it("hash verifies; wrong password fails", () => {
    const h = hashPassword("correct-horse-42");
    expect(verifyPassword("correct-horse-42", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(verifyPassword("x", "garbage")).toBe(false);
  });

  it("password policy: 8+ chars with letter + digit", () => {
    const store = new Store(":memory:");
    expect(() => registerUser(store, "LongEnough", "alllettershere")).toThrow(/weak-password/);
    expect(() => registerUser(store, "DigitsOnly", "12345678")).toThrow(/weak-password/);
    expect(() => registerUser(store, "Fine1", "pass123")).toThrow(/weak-password/);
    expect(() => registerUser(store, "Good2", "pass1234")).not.toThrow();
  });

  it("email optional, validated, unique", () => {
    const store = new Store(":memory:");
    registerUser(store, "Maily", "pass123456", "ME@Example.com");
    const row = store.db.prepare("SELECT email FROM users WHERE name=?").get("Maily") as { email: string };
    expect(row.email).toBe("me@example.com");
    expect(() => registerUser(store, "Other", "pass123456", "not-an-email")).toThrow(/bad-email/);
    expect(() => registerUser(store, "Dup", "pass123456", "me@example.com")).toThrow(/name-taken/);
  });

  it("captcha single-use, expiring, answer-checked", () => {
    const c = issueCaptcha(1000);
    expect(c.question.length).toBeGreaterThan(3);
    expect(checkCaptcha("nope", "1", 1000)).toBe(false);
    // wrong answer consumes it
    const c2 = issueCaptcha(1000);
    expect(checkCaptcha(c2.id, "definitely-wrong!!", 1000)).toBe(false);
    expect(checkCaptcha(c2.id, "0", 1000)).toBe(false); // already consumed
    // expired
    const c3 = issueCaptcha(1000);
    expect(checkCaptcha(c3.id, "0", 1000 + 5 * 60_000 + 1)).toBe(false);
  });

  it("register/login round-trip; names case-insensitive unique", () => {
    const store = new Store(":memory:");
    const { userId } = registerUser(store, "Akiyama", "s3cur3-pass");
    expect(() => registerUser(store, "akiyama", "another-pass1")).toThrow(/name-taken/);
    expect(() => registerUser(store, "No", "s3cur3-pass")).toThrow(/bad-name/);
    expect(() => registerUser(store, "Weak", "short")).toThrow(/weak-password/);
    const back = loginUser(store, "AKIYAMA", "s3cur3-pass");
    expect(back.userId).toBe(userId);
    expect(() => loginUser(store, "Akiyama", "nope-nope-nope")).toThrow(/bad-credentials/);
    expect(profileOf(store, userId)).toMatchObject({ name: "Akiyama", matches: 0 });
  });

  it("deleteAccount erases user, stats, and revokes sessions", () => {
    const store = new Store(":memory:");
    const { userId } = registerUser(store, "Gone", "delete-me-99");
    const sid = newId("s");
    store.db.prepare("INSERT INTO sessions(id,token_hash,display_name,created_at) VALUES(?,?,?,?)").run(sid, sha256("z"), "Gone", Date.now());
    linkSession(store, sid, userId);
    deleteAccount(store, userId);
    expect(profileOf(store, userId)).toBeNull();
    expect(() => loginUser(store, "Gone", "delete-me-99")).toThrow();
    const s = store.db.prepare("SELECT revoked FROM sessions WHERE id=?").get(sid) as { revoked: number };
    expect(s.revoked).toBe(1);
  });
});

describe("accounts in matches", () => {
  const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));

  it("blocklisted text is rejected at submission", async () => {
    const { engine, sessions } = engineWithUsers();
    const code = engine.createRoom(sessions[0], "Host", { targetParticipants: 3, minParticipants: 3, roundIntroSec: 0 });
    engine.joinRoom(code, sessions[1], "P1");
    engine.joinRoom(code, sessions[2], "P2");
    engine.startMatch(code, sessions[0]);
    engine.blockQuestionText("is spam ok? (yes/no)", "test");
    expect(() => engine.submitQuestion(code, sessions[0], "Is spam OK? (YES/NO)")).toThrow(/blocked/);
  });

  it("stats accumulate across a full match for linked users", async () => {
    const { store, engine, sessions } = engineWithUsers();
    for (let i = 0; i < 3; i++) {
      const { userId } = registerUser(store, `Player${i}`, `password-${i}-x`);
      linkSession(store, sessions[i], userId);
    }
    const code = engine.createRoom(sessions[0], "Host", { targetParticipants: 3, minParticipants: 3, roundIntroSec: 0 });
    engine.joinRoom(code, sessions[1], "P1");
    engine.joinRoom(code, sessions[2], "P2");
    engine.startMatch(code, sessions[0]);
    for (const p of engine.participants(code).filter((x) => x.kind === "HUMAN"))
      engine.submitQuestion(code, p.session_id!, `Question from ${p.display_name} here? (YES/NO)`);
    const n = engine.participants(code).length;
    for (let r = 0; r < n; r++) {
      await tick();
      engine.participants(code).forEach((p, i) => engine.recordVote(code, p.id, i % 2 === 0 ? "YES" : "NO", true));
      engine.advanceNow(code);
    }
    expect(engine.getRoom(code)!.state).toBe("MATCH_COMPLETED");
    const rows = store.db.prepare("SELECT matches, wins, minority_wins FROM user_stats").all() as {
      matches: number;
      wins: number;
      minority_wins: number;
    }[];
    expect(rows).toHaveLength(3);
    for (const s of rows) {
      expect(s.matches).toBe(1);
      expect(s.minority_wins).toBeGreaterThanOrEqual(0);
    }
    const totalWins = rows.reduce((a, s) => a + s.wins, 0);
    expect(totalWins).toBeGreaterThanOrEqual(1); // top (possibly tied) counts
    const totalMin = rows.reduce((a, s) => a + s.minority_wins, 0);
    expect(totalMin).toBeGreaterThan(0);
  });

  it("guests without accounts leave no stats", async () => {
    const { store, engine, sessions } = engineWithUsers();
    const code = engine.createRoom(sessions[0], "Host", { targetParticipants: 3, minParticipants: 3, roundIntroSec: 0 });
    engine.joinRoom(code, sessions[1], "P1");
    engine.joinRoom(code, sessions[2], "P2");
    engine.startMatch(code, sessions[0]);
    for (const p of engine.participants(code).filter((x) => x.kind === "HUMAN"))
      engine.submitQuestion(code, p.session_id!, `Guest question ${p.id.slice(-4)} here? (YES/NO)`);
    const n = engine.participants(code).length;
    for (let r = 0; r < n; r++) {
      await tick();
      engine.participants(code).forEach((p, i) => engine.recordVote(code, p.id, i % 2 === 0 ? "YES" : "NO", true));
      engine.advanceNow(code);
    }
    const c = (store.db.prepare("SELECT COUNT(*) AS c FROM user_stats").get() as { c: number }).c;
    expect(c).toBe(0);
  });
});
