import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** SQLite via node:sqlite (WAL). Same parameterized SQL ports to Postgres later. */
export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rooms(
        code TEXT PRIMARY KEY, host_session_id TEXT,
        settings TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'WAITING_FOR_PLAYERS',
        round_no INTEGER NOT NULL DEFAULT 0, question_order TEXT NOT NULL DEFAULT '[]',
        deadline_ms INTEGER, created_at INTEGER NOT NULL, completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS participants(
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        session_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('HUMAN','BOT')),
        display_name TEXT NOT NULL, balance INTEGER NOT NULL,
        connected INTEGER NOT NULL DEFAULT 1, bot_takeover INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 0, question_id TEXT,
        minority_wins INTEGER NOT NULL DEFAULT 0, rounds_played INTEGER NOT NULL DEFAULT 0,
        valid_votes INTEGER NOT NULL DEFAULT 0, largest_payout INTEGER NOT NULL DEFAULT 0,
        ties INTEGER NOT NULL DEFAULT 0,
        UNIQUE(room_code, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_part_room ON participants(room_code);
      CREATE TABLE IF NOT EXISTS questions(
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        participant_id TEXT NOT NULL, text TEXT NOT NULL, normalized TEXT NOT NULL,
        fallback INTEGER NOT NULL DEFAULT 0, play_order INTEGER,
        UNIQUE(room_code, normalized), UNIQUE(room_code, participant_id)
      );
      CREATE TABLE IF NOT EXISTS rounds(
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        round_no INTEGER NOT NULL, question_id TEXT NOT NULL, pot INTEGER NOT NULL DEFAULT 0,
        yes INTEGER NOT NULL DEFAULT 0, no INTEGER NOT NULL DEFAULT 0,
        minority TEXT, settled INTEGER NOT NULL DEFAULT 0,
        UNIQUE(room_code, round_no)
      );
      CREATE TABLE IF NOT EXISTS votes(
        room_code TEXT NOT NULL, round_no INTEGER NOT NULL, participant_id TEXT NOT NULL,
        vote TEXT NOT NULL CHECK(vote IN ('YES','NO')), updated_at INTEGER NOT NULL,
        PRIMARY KEY(room_code, round_no, participant_id)
      );
      CREATE TABLE IF NOT EXISTS ledger(
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, round_no INTEGER NOT NULL,
        participant_id TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
        before_bal INTEGER NOT NULL, after_bal INTEGER NOT NULL, ref TEXT NOT NULL, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_room ON ledger(room_code, round_no);
      CREATE TABLE IF NOT EXISTS settlements(
        room_code TEXT NOT NULL, round_no INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(room_code, round_no)
      );
      CREATE TABLE IF NOT EXISTS reports(
        id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL,
        reporter_id TEXT NOT NULL, question_id TEXT, reason TEXT NOT NULL, ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sec_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_stats(
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        matches INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        minority_wins INTEGER NOT NULL DEFAULT 0, net_chips INTEGER NOT NULL DEFAULT 0,
        best_rank INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS blocklist(
        normalized TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL
      );
      -- link guest sessions to registered users (nullable until login/register)
      CREATE TABLE IF NOT EXISTS session_users(
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  }

  transaction<T>(fn: () => T): T {
    // node:sqlite: BEGIN/COMMIT around fn; rollback on throw
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw e;
    }
  }

  secEvent(kind: string, detail: string) {
    this.db.prepare("INSERT INTO sec_events(ts,kind,detail) VALUES(?,?,?)").run(Date.now(), kind, detail.slice(0, 2000));
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const b = randomBytes(6);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}
