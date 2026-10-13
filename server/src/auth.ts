import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import type { Store } from "./store.js";
import { newId } from "./store.js";

const MIN_PASSWORD = 8;

export function validPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= MIN_PASSWORD && pw.length <= 128;
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

export function registerUser(store: Store, name: string, pw: string): { userId: string } {
  const clean = name.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 24);
  if (clean.length < 3) throw new Error("bad-name");
  if (!validPassword(pw)) throw new Error("weak-password");
  const id = newId("u");
  try {
    store.transaction(() => {
      store.db.prepare("INSERT INTO users(id,name,pass_hash,created_at) VALUES(?,?,?,?)").run(id, clean, hashPassword(pw), Date.now());
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
