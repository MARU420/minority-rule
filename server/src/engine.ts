import { DEFAULT_SETTINGS, validateSettings, type MatchSettings } from "./domain/config.js";
import { settleRound } from "./domain/economy.js";
import { sortLeaderboard, type LeaderboardRow } from "./domain/leaderboard.js";
import { BOT_QUESTION_BANK, FALLBACK_QUESTIONS, checkQuestion, normalizeQuestion } from "./domain/questions.js";
import { botChooseVote, botDisplayName, botPickQuestion, type BotStrategy } from "./domain/bots.js";
import { cryptoRand, seededRng, shuffle, type Rand } from "./domain/rng.js";
import { canTransition, type MatchState } from "./domain/states.js";
import { newId, newRoomCode, type Store } from "./store.js";
import type { Vote } from "./domain/minority.js";

export interface Emit {
  toRoom(code: string, event: string, payload: unknown): void;
}

export interface RoomRow {
  code: string;
  host_session_id: string | null;
  settings: MatchSettings;
  state: MatchState;
  round_no: number;
  question_order: string[];
  deadline_ms: number | null;
}

export interface ParticipantRow {
  id: string;
  session_id: string | null;
  kind: "HUMAN" | "BOT";
  display_name: string;
  balance: number;
  connected: number;
  bot_takeover: number;
  ready: number;
  question_id: string | null;
  minority_wins: number;
  rounds_played: number;
  valid_votes: number;
  largest_payout: number;
  ties: number;
}

const BOT_STRATEGIES: BotStrategy[] = ["random", "majority-predict", "minority-seek", "adaptive"];

export class EngineError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export class Engine {
  private timers = new Map<string, NodeJS.Timeout[]>();
  constructor(
    private readonly store: Store,
    private readonly emit: Emit,
    private readonly rand: Rand = cryptoRand,
    private readonly testSeed?: number,
  ) {}

  // ---------- helpers ----------
  private later(code: string, ms: number, fn: () => void) {
    const t = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        this.store.secEvent("timer-error", `${code}: ${(e as Error).message}`.slice(0, 500));
      }
    }, ms);
    const arr = this.timers.get(code) ?? [];
    arr.push(t);
    this.timers.set(code, arr);
  }

  private clearTimers(code: string) {
    for (const t of this.timers.get(code) ?? []) clearTimeout(t);
    this.timers.delete(code);
  }

  getRoom(code: string): RoomRow | null {
    const r = this.store.db.prepare("SELECT * FROM rooms WHERE code=?").get(code) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      code: r.code as string,
      host_session_id: r.host_session_id as string | null,
      settings: JSON.parse(r.settings as string),
      state: r.state as MatchState,
      round_no: r.round_no as number,
      question_order: JSON.parse(r.question_order as string),
      deadline_ms: r.deadline_ms as number | null,
    };
  }

  participants(code: string): ParticipantRow[] {
    return this.store.db.prepare("SELECT * FROM participants WHERE room_code=? ORDER BY rowid").all(code) as unknown as ParticipantRow[];
  }

  participantBySession(code: string, sessionId: string): ParticipantRow | null {
    const r = this.store.db
      .prepare("SELECT * FROM participants WHERE room_code=? AND session_id=?")
      .get(code, sessionId) as ParticipantRow | undefined;
    return r ?? null;
  }

  private setState(code: string, next: MatchState) {
    const room = this.getRoom(code);
    if (!room) throw new EngineError("no-room");
    if (!canTransition(room.state, next)) {
      this.store.secEvent("invalid-transition", `${code}: ${room.state} -> ${next}`);
      throw new EngineError("invalid-transition");
    }
    this.store.db.prepare("UPDATE rooms SET state=? WHERE code=?").run(next, code);
  }

  private botRand(): Rand {
    return this.testSeed !== undefined ? seededRng(this.testSeed + Math.floor(Math.random() * 1e9)) : cryptoRand;
  }

  // ---------- lobby ----------
  createRoom(hostSessionId: string, displayName: string, settingsInput: unknown): string {
    const settings = validateSettings({ ...DEFAULT_SETTINGS, ...(settingsInput as object) });
    const code = this.store.transaction(() => {
      const c = newRoomCode();
      this.store.db
        .prepare("INSERT INTO rooms(code,host_session_id,settings,created_at) VALUES(?,?,?,?)")
        .run(c, hostSessionId, JSON.stringify(settings), Date.now());
      this.store.db
        .prepare(
          "INSERT INTO participants(id,room_code,session_id,kind,display_name,balance) VALUES(?,?,?,?,?,?)",
        )
        .run(newId("p"), c, hostSessionId, "HUMAN", sanitizeName(displayName), settings.startingBalance);
      return c;
    });
    this.broadcastRoom(code);
    return code;
  }

  joinRoom(code: string, sessionId: string, displayName: string): ParticipantRow {
    const room = this.getRoom(code);
    if (!room) throw new EngineError("no-room");
    if (room.state !== "WAITING_FOR_PLAYERS") throw new EngineError("room-locked");
    const existing = this.participantBySession(code, sessionId);
    if (existing) return existing;
    const parts = this.participants(code);
    if (parts.length >= room.settings.maxParticipants) throw new EngineError("room-full");
    const row = this.store.transaction(() => {
      const id = newId("p");
      this.store.db
        .prepare("INSERT INTO participants(id,room_code,session_id,kind,display_name,balance) VALUES(?,?,?,?,?,?)")
        .run(id, code, sessionId, "HUMAN", sanitizeName(displayName), room.settings.startingBalance);
      return this.participantBySession(code, sessionId)!;
    });
    this.emit.toRoom(code, "PLAYER_JOINED", { participantId: row.id, displayName: row.display_name });
    this.broadcastRoom(code);
    return row;
  }

  leaveRoom(code: string, sessionId: string) {
    const room = this.getRoom(code);
    if (!room) throw new EngineError("no-room");
    if (room.state !== "WAITING_FOR_PLAYERS") throw new EngineError("room-locked");
    this.store.transaction(() => {
      this.store.db.prepare("DELETE FROM participants WHERE room_code=? AND session_id=?").run(code, sessionId);
      const rest = this.participants(code);
      if (rest.length === 0) {
        this.store.db.prepare("DELETE FROM rooms WHERE code=?").run(code);
        return;
      }
      if (room.host_session_id === sessionId) {
        const nextHost = rest.find((p) => p.kind === "HUMAN" && p.connected);
        this.store.db.prepare("UPDATE rooms SET host_session_id=? WHERE code=?").run(nextHost?.session_id ?? null, code);
      }
    });
    this.emit.toRoom(code, "PLAYER_LEFT", {});
    this.broadcastRoom(code);
  }

  setReady(code: string, sessionId: string, ready: boolean) {
    const room = this.getRoom(code);
    if (!room || room.state !== "WAITING_FOR_PLAYERS") throw new EngineError("bad-state");
    this.store.db.prepare("UPDATE participants SET ready=? WHERE room_code=? AND session_id=?").run(ready ? 1 : 0, code, sessionId);
    this.broadcastRoom(code);
  }

  // ---------- match start / bot fill ----------
  startMatch(code: string, sessionId: string) {
    const room = this.getRoom(code);
    if (!room) throw new EngineError("no-room");
    if (room.host_session_id !== sessionId) throw new EngineError("not-host");
    if (room.state !== "WAITING_FOR_PLAYERS") throw new EngineError("bad-state");
    const humans = this.participants(code).filter((p) => p.kind === "HUMAN");
    const s = room.settings;
    if (humans.length < s.minParticipants) throw new EngineError("not-enough-players");

    this.store.transaction(() => {
      // bot-fill up to target
      if (s.botFill) {
        const need = Math.min(s.targetParticipants, s.maxParticipants) - humans.length;
        const used = new Set<string>();
        for (let i = 0; i < need; i++) {
          const idx = this.participants(code).filter((p) => p.kind === "BOT").length;
          const q = botPickQuestion(
            BOT_QUESTION_BANK.map((b) => b.text),
            used,
            this.botRand(),
          );
          used.add(normalizeQuestion(q));
          const pid = newId("p");
          this.store.db
            .prepare("INSERT INTO participants(id,room_code,kind,display_name,balance) VALUES(?,?,?,?,?)")
            .run(pid, code, "BOT", botDisplayName(idx), s.startingBalance);
          const qid = newId("q");
          this.store.db
            .prepare("INSERT INTO questions(id,room_code,participant_id,text,normalized) VALUES(?,?,?,?,?)")
            .run(qid, code, pid, q, normalizeQuestion(q));
          this.store.db.prepare("UPDATE participants SET question_id=? WHERE id=?").run(qid, pid);
        }
      }
      this.setState(code, "QUESTION_SUBMISSION");
      const deadline = Date.now() + s.submissionDurationSec * 1000;
      this.store.db.prepare("UPDATE rooms SET deadline_ms=? WHERE code=?").run(deadline, code);
    });

    this.emit.toRoom(code, "MATCH_STARTED", { phase: "QUESTION_SUBMISSION" });
    this.broadcastRoom(code);
    this.later(code, room.settings.submissionDurationSec * 1000, () => this.resolveSubmission(code));
  }

  extendSubmission(code: string, sessionId: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "QUESTION_SUBMISSION") throw new EngineError("bad-state");
    if (room.host_session_id !== sessionId) throw new EngineError("not-host");
    const extended = (room.deadline_ms ?? Date.now()) + 60_000;
    this.store.db.prepare("UPDATE rooms SET deadline_ms=? WHERE code=?").run(extended, code);
    this.clearTimers(code);
    this.later(code, Math.max(1000, extended - Date.now()), () => this.resolveSubmission(code));
    this.broadcastRoom(code);
  }

  submitQuestion(code: string, sessionId: string, text: unknown) {
    const room = this.getRoom(code);
    if (!room || room.state !== "QUESTION_SUBMISSION") throw new EngineError("bad-state");
    const p = this.participantBySession(code, sessionId);
    if (!p || p.kind !== "HUMAN") throw new EngineError("not-participant");
    if (p.question_id) throw new EngineError("already-submitted");
    const chk = checkQuestion(text, room.settings.maxQuestionLength);
    if (!chk.ok) throw new EngineError(`bad-question:${chk.reason}`);
    const clean = (text as string).normalize("NFKC").replace(/\s+/g, " ").trim();
    const norm = normalizeQuestion(clean);
    try {
      this.store.transaction(() => {
        const qid = newId("q");
        this.store.db
          .prepare("INSERT INTO questions(id,room_code,participant_id,text,normalized) VALUES(?,?,?,?,?)")
          .run(qid, code, p.id, clean, norm);
        this.store.db.prepare("UPDATE participants SET question_id=? WHERE id=?").run(qid, p.id);
      });
    } catch {
      throw new EngineError("duplicate-question");
    }
    const parts = this.participants(code);
    this.emit.toRoom(code, "SUBMISSION_STATUS_UPDATED", {
      submitted: parts.filter((x) => x.question_id).length,
      total: parts.length,
    });
    if (parts.every((x) => x.question_id)) {
      this.clearTimers(code);
      this.resolveSubmission(code);
    }
  }

  /** Lock roster+questions, shuffle (crypto), persist order, start rounds. */
  resolveSubmission(code: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "QUESTION_SUBMISSION") return;
    this.store.transaction(() => {
      const parts = this.participants(code);
      if (parts.length < room.settings.minParticipants) {
        this.setState(code, "MATCH_CANCELLED");
        return;
      }
      // fallback for missing humans (documented default policy)
      const used = new Set(
        (this.store.db.prepare("SELECT normalized FROM questions WHERE room_code=?").all(code) as { normalized: string }[]).map(
          (r) => r.normalized,
        ),
      );
      for (const p of parts) {
        if (!p.question_id && p.kind === "HUMAN") {
          const fb = FALLBACK_QUESTIONS.find((q) => !used.has(normalizeQuestion(q))) ?? FALLBACK_QUESTIONS[0];
          used.add(normalizeQuestion(fb));
          const qid = newId("q");
          this.store.db
            .prepare("INSERT INTO questions(id,room_code,participant_id,text,normalized,fallback) VALUES(?,?,?,?,?,1)")
            .run(qid, code, p.id, fb, normalizeQuestion(fb));
          this.store.db.prepare("UPDATE participants SET question_id=? WHERE id=?").run(qid, p.id);
        }
      }
      const qs = (this.store.db.prepare("SELECT id FROM questions WHERE room_code=?").all(code) as { id: string }[]).map(
        (r) => r.id,
      );
      const order = shuffle(qs, this.rand);
      this.store.db.prepare("UPDATE rooms SET question_order=? WHERE code=?").run(JSON.stringify(order), code);
      this.store.db.prepare("UPDATE questions SET play_order=? WHERE id=?");
      order.forEach((qid, i) =>
        this.store.db.prepare("UPDATE questions SET play_order=? WHERE id=?").run(i, qid),
      );
      this.setState(code, "PREPARING_MATCH");
    });
    const after = this.getRoom(code)!;
    if (after.state === "MATCH_CANCELLED") {
      this.emit.toRoom(code, "MATCH_COMPLETED", { cancelled: true });
      return;
    }
    this.openRound(code, 0);
  }

  // ---------- rounds ----------
  private openRound(code: string, roundNo: number) {
    const room = this.getRoom(code)!;
    const order = room.question_order;
    if (roundNo >= order.length) {
      this.finishMatch(code);
      return;
    }
    const q = this.store.db.prepare("SELECT * FROM questions WHERE id=?").get(order[roundNo]) as {
      id: string;
      text: string;
      participant_id: string;
    };
    const author = this.store.db.prepare("SELECT display_name FROM participants WHERE id=?").get(q.participant_id) as {
      display_name: string;
    };
    this.store.transaction(() => {
      // deduct stakes (min(stake,balance)), ledger STAKE
      const parts = this.participants(code);
      const roundId = `${code}:r${roundNo}`;
      this.store.db.prepare("INSERT INTO rounds(id,room_code,round_no,question_id) VALUES(?,?,?,?)").run(roundId, code, roundNo, q.id);
      for (const p of parts) {
        const staked = Math.max(0, Math.min(room.settings.stake, Math.floor(p.balance)));
        const afterBal = p.balance - staked;
        this.store.db.prepare("UPDATE participants SET balance=?, rounds_played=rounds_played+1 WHERE id=?").run(afterBal, p.id);
        this.store.db
          .prepare("INSERT INTO ledger(room_code,round_no,participant_id,type,amount,before_bal,after_bal,ref,ts) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(code, roundNo, p.id, "STAKE", -staked, p.balance, afterBal, roundId, Date.now());
      }
      this.store.db.prepare("UPDATE rooms SET round_no=? WHERE code=?").run(roundNo, code);
      this.setState(code, "ROUND_INTRO");
      const deadline = Date.now() + room.settings.roundIntroSec * 1000;
      this.store.db.prepare("UPDATE rooms SET deadline_ms=? WHERE code=?").run(deadline, code);
    });
    const pot = this.potOf(code, roundNo);
    this.emit.toRoom(code, "ROUND_STARTED", {
      round: roundNo + 1,
      totalRounds: order.length,
      question: room.settings.revealAuthorship ? { text: q.text, author: author.display_name } : { text: q.text },
      pot,
      votingOpensInSec: room.settings.roundIntroSec,
    });
    this.broadcastRoom(code);
    this.later(code, Math.max(0, room.settings.roundIntroSec * 1000), () => this.openVoting(code));
  }

  private potOf(code: string, roundNo: number): number {
    const r = this.store.db
      .prepare("SELECT COALESCE(SUM(CASE WHEN type='STAKE' THEN -amount ELSE 0 END),0) AS pot FROM ledger WHERE room_code=? AND round_no=?")
      .get(code, roundNo) as { pot: number };
    return r.pot;
  }

  private openVoting(code: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "ROUND_INTRO") return;
    this.store.transaction(() => {
      this.setState(code, "VOTING_OPEN");
      const deadline = Date.now() + room.settings.votingDurationSec * 1000;
      this.store.db.prepare("UPDATE rooms SET deadline_ms=? WHERE code=?").run(deadline, code);
    });
    this.emit.toRoom(code, "ROUND_STARTED", { voting: true, deadlineMs: this.getRoom(code)!.deadline_ms });
    this.broadcastRoom(code);
    // schedule bot votes (same pipeline, delayed 2-8s)
    const parts = this.participants(code);
    parts.forEach((p, i) => {
      const needsBot = p.kind === "BOT" || (p.bot_takeover === 1 && p.connected === 0);
      if (!needsBot) return;
      const delay = 2000 + ((i * 1373) % 6000);
      this.later(code, delay, () => this.castBotVote(code, p.id));
    });
    this.later(code, room.settings.votingDurationSec * 1000, () => this.lockAndResolve(code, "deadline"));
  }

  private publicHistory(code: string): { yes: number; no: number; minority: Vote | null }[] {
    const rows = this.store.db
      .prepare("SELECT yes,no,minority FROM rounds WHERE room_code=? AND settled=1 ORDER BY round_no")
      .all(code) as { yes: number; no: number; minority: string | null }[];
    return rows.map((r) => ({ yes: r.yes, no: r.no, minority: (r.minority as Vote | null) ?? null }));
  }

  private castBotVote(code: string, participantId: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "VOTING_OPEN") return;
    const parts = this.participants(code);
    const idx = parts.findIndex((p) => p.id === participantId);
    const history = this.publicHistory(code);
    const ownVotes = (this.store.db
      .prepare("SELECT vote FROM votes WHERE room_code=? AND participant_id=? ORDER BY round_no")
      .all(code, participantId) as { vote: Vote }[]).map((r) => r.vote);
    const vote = botChooseVote({
      strategy: BOT_STRATEGIES[Math.max(0, idx) % BOT_STRATEGIES.length],
      difficulty: "normal",
      history,
      ownVotes,
      rand: this.botRand(),
    });
    this.recordVote(code, participantId, vote, true);
  }

  /** Shared validation+write pipeline for human AND bot votes. */
  recordVote(code: string, participantId: string, vote: Vote, internal = false): { locked: boolean } {
    const room = this.getRoom(code);
    if (!room) throw new EngineError("no-room");
    if (room.state !== "VOTING_OPEN") throw new EngineError("voting-closed");
    if (vote !== "YES" && vote !== "NO") throw new EngineError("bad-vote");
    if (!internal && Date.now() > (room.deadline_ms ?? 0)) throw new EngineError("past-deadline");
    const p = this.store.db.prepare("SELECT * FROM participants WHERE id=? AND room_code=?").get(participantId, code) as
      | ParticipantRow
      | undefined;
    if (!p) throw new EngineError("not-participant");
    if (!room.settings.allowVoteChange) {
      const ex = this.store.db
        .prepare("SELECT 1 FROM votes WHERE room_code=? AND round_no=? AND participant_id=?")
        .get(code, room.round_no, participantId);
      if (ex) throw new EngineError("already-voted");
    }
    this.store.db
      .prepare("INSERT INTO votes(room_code,round_no,participant_id,vote,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(room_code,round_no,participant_id) DO UPDATE SET vote=excluded.vote, updated_at=excluded.updated_at")
      .run(code, room.round_no, participantId, vote, Date.now());
    const voted = this.votedIds(code, room.round_no);
    this.emit.toRoom(code, "VOTE_STATUS_UPDATED", { voted: voted.length, total: this.participants(code).length });
    const allIn = this.participants(code).every((x) => voted.includes(x.id));
    if (allIn) {
      this.clearTimers(code);
      this.lockAndResolve(code, "all-in");
      return { locked: true };
    }
    return { locked: false };
  }

  private votedIds(code: string, roundNo: number): string[] {
    return (this.store.db.prepare("SELECT participant_id AS id FROM votes WHERE room_code=? AND round_no=?").all(code, roundNo) as { id: string }[]).map(
      (r) => r.id,
    );
  }

  submitVote(code: string, sessionId: string, vote: Vote) {
    const p = this.participantBySession(code, sessionId);
    if (!p) throw new EngineError("not-participant");
    return this.recordVote(code, p.id, vote);
  }

  lockAndResolve(code: string, _why: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "VOTING_OPEN") return; // idempotent: only open rounds settle
    this.clearTimers(code);
    this.store.transaction(() => {
      this.setState(code, "VOTING_LOCKED");
      this.emit.toRoom(code, "VOTING_LOCKED", { round: room.round_no + 1 });
      this.setState(code, "ROUND_RESOLUTION");
    });
    this.store.transaction(() => {
      // double-settlement guard: exactly one settlement row may exist
      const ex = this.store.db.prepare("SELECT 1 FROM settlements WHERE room_code=? AND round_no=?").get(code, room.round_no);
      if (ex) return;
      const parts = this.participants(code);
      const balances = new Map(parts.map((p) => [p.id, p.balance + this.stakeOf(code, room.round_no, p.id)]));
      // balances map must be PRE-stake; stakeOf reads ledger STAKE for the round
      const votes = new Map<string, Vote>();
      for (const v of this.store.db.prepare("SELECT participant_id AS pid, vote FROM votes WHERE room_code=? AND round_no=?").all(code, room.round_no) as {
        pid: string;
        vote: Vote;
      }[])
        votes.set(v.pid, v.vote);
      const roundId = `${code}:r${room.round_no}`;
      const { settlement, newBalances } = settleRound(roundId, balances, votes, room.settings.stake, this.rand);
      // persist balances + ledger (PAYOUT/REFUND) + stats
      for (const [pid, bal] of newBalances) {
        const before = this.store.db.prepare("SELECT balance FROM participants WHERE id=?").get(pid) as { balance: number };
        this.store.db.prepare("UPDATE participants SET balance=? WHERE id=?").run(bal, pid);
        void before;
      }
      for (const pay of settlement.payouts) {
        const b = newBalances.get(pay.participantId)!;
        this.store.db
          .prepare("INSERT INTO ledger(room_code,round_no,participant_id,type,amount,before_bal,after_bal,ref,ts) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(code, room.round_no, pay.participantId, "PAYOUT", pay.gross, b - pay.gross, b, roundId, Date.now());
        this.store.db
          .prepare("UPDATE participants SET minority_wins=minority_wins+1, largest_payout=MAX(largest_payout,?) WHERE id=?")
          .run(pay.gross, pay.participantId);
      }
      for (const r of settlement.refunds) {
        const b = newBalances.get(r.participantId)!;
        this.store.db
          .prepare("INSERT INTO ledger(room_code,round_no,participant_id,type,amount,before_bal,after_bal,ref,ts) VALUES(?,?,?,?,?,?,?,?,?)")
          .run(code, room.round_no, r.participantId, "REFUND", r.staked, b - r.staked, b, roundId, Date.now());
      }
      for (const v of votes.keys())
        this.store.db.prepare("UPDATE participants SET valid_votes=valid_votes+1 WHERE id=?").run(v);
      if (settlement.outcome.minority === null) {
        this.store.db.prepare("UPDATE participants SET ties=ties+1 WHERE room_code=?").run(code);
      }
      this.store.db
        .prepare("UPDATE rounds SET yes=?,no=?,minority=?,pot=?,settled=1 WHERE room_code=? AND round_no=?")
        .run(settlement.outcome.yes, settlement.outcome.no, settlement.outcome.minority, settlement.pot, code, room.round_no);
      this.store.db.prepare("INSERT INTO settlements(room_code,round_no,payload) VALUES(?,?,?)").run(code, room.round_no, JSON.stringify(settlement));
      this.setState(code, "ROUND_RESULTS");
    });
    const st = this.store.db.prepare("SELECT yes,no,minority,pot FROM rounds WHERE room_code=? AND round_no=?").get(code, room.round_no) as {
      yes: number;
      no: number;
      minority: string | null;
      pot: number;
    };
    const votesFull = this.store.db
      .prepare("SELECT participant_id AS pid, vote FROM votes WHERE room_code=? AND round_no=?")
      .all(code, room.round_no);
    this.emit.toRoom(code, "ROUND_RESOLVED", {
      round: room.round_no + 1,
      yes: st.yes,
      no: st.no,
      minority: st.minority,
      pot: st.pot,
      votes: votesFull,
    });
    this.emit.toRoom(code, "LEADERBOARD_UPDATED", { leaderboard: this.leaderboard(code) });
    this.broadcastRoom(code);
    this.later(code, 8000, () => this.afterResults(code));
  }

  private stakeOf(code: string, roundNo: number, pid: string): number {
    const r = this.store.db
      .prepare("SELECT -amount AS s FROM ledger WHERE room_code=? AND round_no=? AND participant_id=? AND type='STAKE'")
      .get(code, roundNo, pid) as { s: number } | undefined;
    return r?.s ?? 0;
  }

  /** Test/dev fast-path: skip pending timers and run scheduled advancement now. */
  advanceNow(code: string) {
    this.clearTimers(code);
    const room = this.getRoom(code);
    if (room && room.state === "ROUND_RESULTS") this.afterResults(code);
  }
  private afterResults(code: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "ROUND_RESULTS") return;
    this.openRound(code, room.round_no + 1);
  }

  readyNext(code: string, _sessionId: string) {
    const room = this.getRoom(code);
    if (!room || room.state !== "ROUND_RESULTS") throw new EngineError("bad-state");
    this.clearTimers(code);
    this.afterResults(code);
  }

  private finishMatch(code: string) {
    this.store.transaction(() => {
      this.setState(code, "MATCH_RESULTS");
    });
    this.emit.toRoom(code, "MATCH_COMPLETED", { leaderboard: this.leaderboard(code) });
    this.store.transaction(() => {
      const r = this.getRoom(code);
      if (r && r.state === "MATCH_RESULTS") {
        this.setState(code, "MATCH_COMPLETED");
        this.store.db.prepare("UPDATE rooms SET completed_at=? WHERE code=?").run(Date.now(), code);
      }
    });
    this.broadcastRoom(code);
  }

  leaderboard(code: string): LeaderboardRow[] {
    const s = this.getRoom(code)?.settings;
    const start = s?.startingBalance ?? DEFAULT_SETTINGS.startingBalance;
    const rows = this.participants(code).map((p) => ({
      participantId: p.id,
      displayName: p.display_name,
      kind: p.kind,
      balance: p.balance,
      net: p.balance - start,
      minorityWins: p.minority_wins,
      roundsPlayed: p.rounds_played,
      validVotes: p.valid_votes,
      largestPayout: p.largest_payout,
      tiesExperienced: p.ties,
    }));
    return sortLeaderboard(rows);
  }

  // ---------- presence ----------
  onDisconnect(sessionId: string) {
    const rooms = this.store.db.prepare("UPDATE participants SET connected=0 WHERE session_id=? RETURNING room_code, id").all(sessionId) as {
      room_code: string;
      id: string;
    }[];
    for (const r of rooms) {
      const room = this.getRoom(r.room_code);
      if (!room) continue;
      if (room.state === "WAITING_FOR_PLAYERS" && room.host_session_id === sessionId) {
        const rest = this.participants(r.room_code).filter((p) => p.kind === "HUMAN" && p.connected === 1);
        this.store.db.prepare("UPDATE rooms SET host_session_id=? WHERE code=?").run(rest[0]?.session_id ?? null, r.room_code);
      }
      if (room.settings.botTakeover && room.state !== "WAITING_FOR_PLAYERS") {
        this.later(r.room_code, room.settings.botTakeoverGraceSec * 1000, () => {
          const still = this.store.db.prepare("SELECT connected FROM participants WHERE id=?").get(r.id) as { connected: number };
          const st = this.getRoom(r.room_code);
          if (still && still.connected === 0 && st && st.state === "VOTING_OPEN") {
            this.store.db.prepare("UPDATE participants SET bot_takeover=1 WHERE id=?").run(r.id);
            this.castBotVote(r.room_code, r.id);
          }
        });
      }
      this.broadcastRoom(r.room_code);
    }
  }

  onReconnect(sessionId: string): string[] {
    this.store.db.prepare("UPDATE participants SET connected=1, bot_takeover=0 WHERE session_id=?").run(sessionId);
    const rows = this.store.db.prepare("SELECT DISTINCT room_code AS c FROM participants WHERE session_id=?").all(sessionId) as { c: string }[];
    for (const r of rows) this.broadcastRoom(r.c);
    return rows.map((r) => r.c);
  }

  cancelRoom(code: string) {
    const room = this.getRoom(code);
    if (!room) return;
    this.clearTimers(code);
    this.store.transaction(() => {
      // refund unsettled round stakes
      const open = this.store.db.prepare("SELECT round_no FROM rounds WHERE room_code=? AND settled=0").get(code) as { round_no: number } | undefined;
      if (open) {
        for (const p of this.participants(code)) {
          const s = this.stakeOf(code, open.round_no, p.id);
          if (s > 0) {
            this.store.db.prepare("UPDATE participants SET balance=balance+? WHERE id=?").run(s, p.id);
            const b = (this.store.db.prepare("SELECT balance FROM participants WHERE id=?").get(p.id) as { balance: number }).balance;
            this.store.db
              .prepare("INSERT INTO ledger(room_code,round_no,participant_id,type,amount,before_bal,after_bal,ref,ts) VALUES(?,?,?,?,?,?,?,?,?)")
              .run(code, open.round_no, p.id, "REFUND", s, b - s, b, `${code}:cancel`, Date.now());
          }
        }
      }
      try {
        this.setState(code, "MATCH_CANCELLED");
      } catch {
        this.store.db.prepare("UPDATE rooms SET state='MATCH_CANCELLED' WHERE code=?").run(code);
      }
    });
    this.emit.toRoom(code, "MATCH_COMPLETED", { cancelled: true });
  }

  /** Boot recovery: cancel non-terminal matches (documented policy), refunding open stakes. */
  recover() {
    const rows = this.store.db.prepare("SELECT code FROM rooms WHERE state NOT IN ('MATCH_COMPLETED','MATCH_CANCELLED')").all() as { code: string }[];
    for (const r of rows) {
      this.store.secEvent("recovery-cancel", r.code);
      this.cancelRoom(r.code);
    }
  }

  // ---------- snapshots / serializers ----------
  broadcastRoom(code: string) {
    this.emit.toRoom(code, "ROOM_UPDATED", this.publicRoom(code));
  }

  publicRoom(code: string) {
    const room = this.getRoom(code);
    if (!room) return null;
    const parts = this.participants(code).map((p) => ({
      id: p.id,
      name: p.display_name,
      kind: p.kind,
      connected: p.connected === 1,
      ready: p.ready === 1,
      submitted: p.question_id !== null,
      isHost: false,
    }));
    const submitted = this.participants(code).filter((p) => p.question_id).length;
    return {
      code,
      state: room.state,
      round: room.round_no + 1,
      totalRounds: room.question_order.length || room.settings.targetParticipants,
      deadlineMs: room.deadline_ms,
      participants: parts,
      submitted,
      total: parts.length,
      settings: {
        targetParticipants: room.settings.targetParticipants,
        minParticipants: room.settings.minParticipants,
        maxParticipants: room.settings.maxParticipants,
        stake: room.settings.stake,
        startingBalance: room.settings.startingBalance,
        votingDurationSec: room.settings.votingDurationSec,
        submissionDurationSec: room.settings.submissionDurationSec,
        revealAuthorship: room.settings.revealAuthorship,
      },
      leaderboard: room.state === "WAITING_FOR_PLAYERS" || room.state === "QUESTION_SUBMISSION" ? [] : this.leaderboard(code),
    };
  }

  /** Private slice for one session: own vote + own status, never others' votes. */
  privateState(code: string, sessionId: string) {
    const room = this.getRoom(code);
    const me = sessionId ? this.participantBySession(code, sessionId) : null;
    const pub = this.publicRoom(code);
    let myVote: Vote | null = null;
    let hasVoted = false;
    if (room && me && (room.state === "VOTING_OPEN" || room.state === "VOTING_LOCKED")) {
      const v = this.store.db
        .prepare("SELECT vote FROM votes WHERE room_code=? AND round_no=? AND participant_id=?")
        .get(code, room.round_no, me.id) as { vote: Vote } | undefined;
      hasVoted = !!v;
      // reveal own vote only after lock (prevents shoulder-surfing via state fetch? own vote is known anyway)
      myVote = v?.vote ?? null;
    }
    let current: unknown = null;
    if (room && room.state !== "WAITING_FOR_PLAYERS" && room.state !== "QUESTION_SUBMISSION" && room.state !== "PREPARING_MATCH") {
      const qid = room.question_order[room.round_no];
      if (qid) {
        const q = this.store.db.prepare("SELECT text, participant_id FROM questions WHERE id=?").get(qid) as {
          text: string;
          participant_id: string;
        };
        current = { text: q.text };
      }
    }
    return { room: pub, me: me ? { id: me.id, balance: me.balance, hasVoted, myVote } : null, current };
  }

  fullState(code: string, sessionId: string) {
    return this.privateState(code, sessionId);
  }
}

export function sanitizeName(input: unknown): string {
  const s = String(input ?? "Player").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 24);
  return s.length > 0 ? s : "Player";
}
