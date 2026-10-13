import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Store, newId, newToken, sha256 } from "./store.js";
import { Engine, EngineError, sanitizeName } from "./engine.js";
import { RateLimiter } from "./ratelimit.js";
import type { Vote } from "./domain/minority.js";

const PORT = Number(process.env.PORT ?? 8081);
const DB_PATH = process.env.DATABASE_PATH ?? "./data/minority.db";
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:8080").split(",").map((s) => s.trim());

const NameSchema = z.string().min(1).max(24);
const CodeSchema = z.string().regex(/^[A-Z2-9]{6}$/);
const VoteSchema = z.enum(["YES", "NO"]);
const QuestionSchema = z.string().min(1).max(500);

const store = new Store(DB_PATH);
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: ORIGINS, methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e5,
  connectionStateRecovery: { maxDisconnectionDuration: 0 },
});
const engine = new Engine(store, { toRoom: (code, event, payload) => io.to(code).emit(event, payload) });

function safeError(socket: Socket, event: string, message: string) {
  socket.emit("SAFE_ERROR", { event, message });
}

function errOf(e: unknown): string {
  return e instanceof EngineError ? e.code : "internal-error";
}

// rate limits (adopted): room-create 1/10s, votes 5/10s, questions 3/min, chat 100/min, conns 5/IP
const rlCreate = new RateLimiter(1, 10_000);
const rlVote = new RateLimiter(5, 10_000);
const rlQuestion = new RateLimiter(3, 60_000);
const rlChat = new RateLimiter(100, 60_000);
const rlSession = new RateLimiter(10, 60_000);
const ipConns = new Map<string, number>();

function sessionOf(socket: Socket): string | null {
  return (socket.data.sessionId as string) ?? null;
}

function requireSession(socket: Socket): string {
  const s = sessionOf(socket);
  if (!s) throw new EngineError("no-session");
  const row = store.db.prepare("SELECT id FROM sessions WHERE id=? AND revoked=0").get(s) as { id: string } | undefined;
  if (!row) throw new EngineError("bad-session");
  return s;
}

io.on("connection", (socket: Socket) => {
  const ip = socket.handshake.address;
  const n = (ipConns.get(ip) ?? 0) + 1;
  ipConns.set(ip, n);
  if (n > 5) {
    socket.emit("SAFE_ERROR", { event: "connect", message: "too-many-connections" });
    socket.disconnect(true);
    return;
  }
  socket.on("disconnect", () => {
    ipConns.set(ip, Math.max(0, (ipConns.get(ip) ?? 1) - 1));
    const s = sessionOf(socket);
    if (s) engine.onDisconnect(s);
  });

  socket.on("ISSUE_SESSION", (raw: unknown) => {
    try {
      if (!rlSession.take(ip)) return safeError(socket, "ISSUE_SESSION", "rate-limited");
      const { displayName } = z.object({ displayName: NameSchema }).parse(raw);
      const id = newId("s");
      const token = newToken();
      store.db
        .prepare("INSERT INTO sessions(id,token_hash,display_name,created_at) VALUES(?,?,?,?)")
        .run(id, sha256(token), sanitizeName(displayName), Date.now());
      socket.data.sessionId = id;
      socket.emit("SESSION_ISSUED", { sessionId: id, token });
    } catch {
      safeError(socket, "ISSUE_SESSION", "invalid-payload");
    }
  });

  socket.on("AUTHENTICATE", (raw: unknown) => {
    try {
      const { sessionId, token } = z.object({ sessionId: z.string(), token: z.string().min(32) }).parse(raw);
      const row = store.db.prepare("SELECT token_hash FROM sessions WHERE id=? AND revoked=0").get(sessionId) as
        | { token_hash: string }
        | undefined;
      if (!row || row.token_hash !== sha256(token)) {
        store.secEvent("auth-fail", sessionId.slice(0, 40));
        return safeError(socket, "AUTHENTICATE", "bad-credentials");
      }
      const a = randomBytes(1)[0];
      void a;
      socket.data.sessionId = sessionId;
      const rooms = engine.onReconnect(sessionId);
      for (const c of rooms) void socket.join(c);
      socket.emit("AUTHENTICATED", { sessionId });
    } catch {
      safeError(socket, "AUTHENTICATE", "invalid-payload");
    }
  });

  socket.on("CREATE_ROOM", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      if (!rlCreate.take(sid)) return safeError(socket, "CREATE_ROOM", "rate-limited");
      const { displayName, settings } = z.object({ displayName: NameSchema, settings: z.record(z.unknown()).optional() }).parse(raw);
      const code = engine.createRoom(sid, displayName, settings ?? {});
      void socket.join(code);
      socket.emit("ROOM_CREATED", { code });
    } catch (e) {
      safeError(socket, "CREATE_ROOM", errOf(e));
    }
  });

  socket.on("JOIN_ROOM", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code, displayName } = z.object({ code: CodeSchema, displayName: NameSchema }).parse(raw);
      engine.joinRoom(code, sid, displayName);
      void socket.join(code);
      socket.emit("ROOM_JOINED", { code });
    } catch (e) {
      safeError(socket, "JOIN_ROOM", errOf(e));
    }
  });

  socket.on("LEAVE_ROOM", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code } = z.object({ code: CodeSchema }).parse(raw);
      engine.leaveRoom(code, sid);
      void socket.leave(code);
    } catch (e) {
      safeError(socket, "LEAVE_ROOM", errOf(e));
    }
  });

  socket.on("READY_UP", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code, ready } = z.object({ code: CodeSchema, ready: z.boolean() }).parse(raw);
      engine.setReady(code, sid, ready);
    } catch (e) {
      safeError(socket, "READY_UP", errOf(e));
    }
  });

  socket.on("START_MATCH", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code } = z.object({ code: CodeSchema }).parse(raw);
      engine.startMatch(code, sid);
    } catch (e) {
      safeError(socket, "START_MATCH", errOf(e));
    }
  });

  socket.on("EXTEND_SUBMISSION", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code } = z.object({ code: CodeSchema }).parse(raw);
      engine.extendSubmission(code, sid);
    } catch (e) {
      safeError(socket, "EXTEND_SUBMISSION", errOf(e));
    }
  });

  socket.on("SUBMIT_QUESTION", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      if (!rlQuestion.take(sid)) return safeError(socket, "SUBMIT_QUESTION", "rate-limited");
      const { code, text } = z.object({ code: CodeSchema, text: QuestionSchema }).parse(raw);
      engine.submitQuestion(code, sid, text);
      socket.emit("QUESTION_ACCEPTED", { code });
    } catch (e) {
      safeError(socket, "SUBMIT_QUESTION", errOf(e));
    }
  });

  socket.on("SUBMIT_VOTE", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      if (!rlVote.take(sid)) return safeError(socket, "SUBMIT_VOTE", "rate-limited");
      const { code, vote } = z.object({ code: CodeSchema, vote: VoteSchema }).parse(raw);
      engine.submitVote(code, sid, vote as Vote);
      socket.emit("VOTE_ACCEPTED", { code });
    } catch (e) {
      safeError(socket, "SUBMIT_VOTE", errOf(e));
    }
  });

  socket.on("READY_NEXT", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code } = z.object({ code: CodeSchema }).parse(raw);
      engine.readyNext(code, sid);
    } catch (e) {
      safeError(socket, "READY_NEXT", errOf(e));
    }
  });

  socket.on("CHAT_MESSAGE", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      if (!rlChat.take(sid)) return;
      const { code, text } = z.object({ code: CodeSchema, text: z.string().min(1).max(300) }).parse(raw);
      const p = engine.participantBySession(code, sid);
      if (!p) return safeError(socket, "CHAT_MESSAGE", "not-participant");
      io.to(code).emit("CHAT_MESSAGE", { from: p.display_name, text });
    } catch {
      safeError(socket, "CHAT_MESSAGE", "invalid-payload");
    }
  });

  socket.on("REPORT_CONTENT", (raw: unknown) => {
    try {
      const sid = requireSession(socket);
      const { code, questionId, reason } = z
        .object({ code: CodeSchema, questionId: z.string().max(64).optional(), reason: z.string().min(1).max(300) })
        .parse(raw);
      const p = engine.participantBySession(code, sid);
      if (!p) return safeError(socket, "REPORT_CONTENT", "not-participant");
      store.db.prepare("INSERT INTO reports(room_code,reporter_id,question_id,reason,ts) VALUES(?,?,?,?,?)").run(code, p.id, questionId ?? null, reason, Date.now());
      socket.emit("REPORT_RECEIVED", { code });
    } catch {
      safeError(socket, "REPORT_CONTENT", "invalid-payload");
    }
  });

  socket.on("REQUEST_PUBLIC_MATCH_STATE", (raw: unknown) => {
    try {
      const { code } = z.object({ code: CodeSchema }).parse(raw);
      socket.emit("PUBLIC_MATCH_STATE", engine.fullState(code, sessionOf(socket) ?? ""));
    } catch {
      safeError(socket, "REQUEST_PUBLIC_MATCH_STATE", "invalid-payload");
    }
  });
});

// boot recovery: cancel interrupted matches (refunding open stakes)
engine.recover();

httpServer.listen(PORT, () => {
  console.log(`minority-rule server on :${PORT}`);
});
