import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import type { Store } from "./store.js";
import { newId } from "./store.js";

const MIN_PASSWORD = 10;

/** Policy: 10+ chars with at least one letter and one digit. */
export function validPassword(pw: unknown): pw is string {
  return (
    typeof pw === "string" &&
    pw.length >= MIN_PASSWORD &&
    pw.length <= 128 &&
    /[A-Za-z]/.test(pw) &&
    /\d/.test(pw)
  );
}

export function validEmail(em: unknown): string | null {
  if (em === undefined || em === null || em === "") return null;
  if (typeof em !== "string") return null;
  const clean = em.trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) throw new Error("bad-email");
  return clean;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const key = scryptSync(pw, parts[1], 64);
  const ref = Buffer.from(parts[2], "hex");
  return key.length === ref.length && timingSafeEqual(key, ref);
}

export function registerUser(store: Store, name: string, pw: string, email?: unknown): { userId: string } {
  const clean = name.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 24);
  if (clean.length < 3) throw new Error("bad-name");
  if (!validPassword(pw)) throw new Error("weak-password");
  const mail = validEmail(email);
  const id = newId("u");
  try {
    store.transaction(() => {
      store.db
        .prepare("INSERT INTO users(id,name,pass_hash,created_at,email) VALUES(?,?,?,?,?)")
        .run(id, clean, hashPassword(pw), Date.now(), mail);
      store.db.prepare("INSERT INTO user_stats(user_id,updated_at) VALUES(?,?)").run(id, Date.now());
    });
  } catch {
    throw new Error("name-taken");
  }
  return { userId: id };
}

export function loginUser(store: Store, name: string, pw: string): { userId: string; displayName: string } {
  const row = store.db.prepare("SELECT id, name, pass_hash FROM users WHERE name=?").get(name.trim()) as
    | { id: string; name: string; pass_hash: string }
    | undefined;
  if (!row || !verifyPassword(pw, row.pass_hash)) throw new Error("bad-credentials");
  return { userId: row.id, displayName: row.name };
}

/** Bind a guest session to a user (login/register completes the link). */
export function linkSession(store: Store, sessionId: string, userId: string) {
  store.db
    .prepare("INSERT INTO session_users(session_id,user_id) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET user_id=excluded.user_id")
    .run(sessionId, userId);
}

export function userOfSession(store: Store, sessionId: string): { userId: string; name: string } | null {
  const row = store.db
    .prepare("SELECT u.id AS userId, u.name FROM session_users su JOIN users u ON u.id=su.user_id WHERE su.session_id=?")
    .get(sessionId) as { userId: string; name: string } | undefined;
  return row ?? null;
}

/** GDPR-style erasure: user row (cascades stats + links), sessions revoked. Match ledgers keep anonymous chip records. */
export function deleteAccount(store: Store, userId: string) {
  store.transaction(() => {
    store.db.prepare("UPDATE sessions SET revoked=1 WHERE id IN (SELECT session_id FROM session_users WHERE user_id=?)").run(userId);
    store.db.prepare("DELETE FROM users WHERE id=?").run(userId);
  });
}

/* ---------- self-hosted captcha (no external service/keys) ---------- */
export interface Captcha {
  id: string;
  question: string;
  answer: string;
  expires: number;
}

const captchas = new Map<string, Captcha>();
let captchaCounter = 0;

function randInt(n: number): number {
  return Math.floor(Math.random() * n);
}

/** Math challenge, 5-minute life. Answers never leave the server. */
export function issueCaptcha(now = Date.now()): { id: string; question: string; expiresInSec: number } {
  if (captchas.size > 5000) captchas.clear();
  const kind = randInt(3);
  let a = 2 + randInt(19);
  let b = 2 + randInt(19);
  let question: string;
  let answer: string;
  if (kind === 0) {
    question = `${a} + ${b} = ?`;
    answer = String(a + b);
  } else if (kind === 1) {
    if (b > a) [a, b] = [b, a];
    question = `${a} − ${b} = ?`;
    answer = String(a - b);
  } else {
    a = 2 + randInt(8);
    b = 2 + randInt(8);
    question = `${a} × ${b} = ?`;
    answer = String(a * b);
  }
  const id = `cap_${now.toString(36)}_${captchaCounter++}_${randInt(1e6).toString(36)}`;
  captchas.set(id, { id, question, answer, expires: now + 5 * 60_000 });
  return { id, question, expiresInSec: 300 };
}

/** Single-use: consumed on check (right or wrong). */
export function checkCaptcha(id: unknown, answer: unknown, now = Date.now()): boolean {
  if (typeof id !== "string" || typeof answer !== "string") return false;
  const c = captchas.get(id);
  captchas.delete(id);
  if (!c || now > c.expires) return false;
  return c.answer === answer.trim();
}

export function profileOf(store: Store, userId: string) {  const u = store.db.prepare("SELECT id, name, created_at FROM users WHERE id=?").get(userId) as
    | { id: string; name: string; created_at: number }
    | undefined;
  const s = store.db.prepare("SELECT * FROM user_stats WHERE user_id=?").get(userId) as Record<string, number> | undefined;
  if (!u || !s) return null;
  return {
    id: u.id,
    name: u.name,
    matches: s.matches,
    wins: s.wins,
    minorityWins: s.minority_wins,
    netChips: s.net_chips,
    bestRank: s.best_rank,
  };
}
