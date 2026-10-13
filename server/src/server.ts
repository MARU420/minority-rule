import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Store, newId, newToken, sha256 } from "./store.js";
import { Engine, EngineError, sanitizeName } from "./engine.js";
import { checkCaptcha, deleteAccount, issueCaptcha, linkSession, loginUser, profileOf, registerUser, userOfSession, verifyPassword } from "./auth.js";
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
  pingInterval: 25_000,
  pingTimeout: 20_000,
  connectTimeout: 10_000,
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
const rlAuth = new RateLimiter(5, 60_000);
const rlRegister = new RateLimiter(3, 3_600_000); // 3 accounts/hour per IP
const rlCaptcha = new RateLimiter(10, 60_000);
const loginFails = new Map<string, number>();
const rlRoomIp = new RateLimiter(10, 3_600_000); // 10 rooms/hour per IP
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_CONNS = Number(process.env.MAX_CONNS ?? 500);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 200);

/** Real client IP behind Render/Cloudflare (first XFF entry only when trusted). */
function clientIp(socket: Socket): string {
  if (TRUST_PROXY) {
    const cf = socket.handshake.headers["cf-connecting-ip"];
    if (typeof cf === "string" && cf) return cf.split(",")[0].trim();
    const xff = socket.handshake.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  }
  return socket.handshake.address;
}
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
  if (io.engine.clientsCount > MAX_CONNS) {
    socket.emit("SAFE_ERROR", { event: "connect", message: "server-full" });
    socket.disconnect(true);
    return;
  }
  const ip = clientIp(socket);
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
      if (!rlSession.take(clientIp(socket))) return safeError(socket, "ISSUE_SESSION", "rate-limited");
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
      if (!rlCreate.take(sid) || !rlRoomIp.take(clientIp(socket))) return safeError(socket, "CREATE_ROOM", "rate-limited");
      const live = (store.db.prepare("SELECT COUNT(*) AS c FROM rooms WHERE state NOT IN ('MATCH_COMPLETED','MATCH_CANCELLED')").get() as { c: number }).c;
      if (live >= MAX_ROOMS) return safeError(socket, "CREATE_ROOM", "server-full");
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

  function sessionOrCreate(socket: Socket): string {
    const existing = sessionOf(socket);
    if (existing) {
      const row = store.db.prepare("SELECT id FROM sessions WHERE id=? AND revoked=0").get(existing) as { id: string } | undefined;
      if (row) return existing;
    }
    const id = newId("s");
    store.db.prepare("INSERT INTO sessions(id,token_hash,display_name,created_at) VALUES(?,?,?,?)").run(id, sha256(newToken()), "Player", Date.now());
    socket.data.sessionId = id;
    return id;
  }

  socket.on("CAPTCHA", () => {
    try {
      if (!rlCaptcha.take(clientIp(socket))) return safeError(socket, "CAPTCHA", "rate-limited");
      socket.emit("CAPTCHA_ISSUED", issueCaptcha());
    } catch {
      safeError(socket, "CAPTCHA", "invalid-payload");
    }
  });

  socket.on("REGISTER", (raw: unknown) => {
    try {
      const ip = clientIp(socket);
      if (!rlAuth.take(ip) || !rlRegister.take(`reg:${ip}`)) return safeError(socket, "REGISTER", "rate-limited");
      const { name, password, email, captchaId, captchaAnswer } = z
        .object({
          name: NameSchema,
          password: z.string().min(10).max(128),
          email: z.string().max(254).optional(),
          captchaId: z.string().max(128),
          captchaAnswer: z.string().max(16),
        })
        .parse(raw);
      if (!checkCaptcha(captchaId, captchaAnswer)) return safeError(socket, "REGISTER", "bad-captcha");
      const { userId } = registerUser(store, name, password, email);
      linkSession(store, sessionOrCreate(socket), userId);
      socket.emit("REGISTERED", { userId });
    } catch (e) {
      const m = e instanceof Error ? e.message : "invalid-payload";
      safeError(
        socket,
        "REGISTER",
        ["bad-name", "weak-password", "bad-email", "name-taken"].includes(m) ? m : "invalid-payload",
      );
    }
  });

  socket.on("LOGIN", async (raw: unknown) => {
    try {
      const ip = clientIp(socket);
      if (!rlAuth.take(ip)) return safeError(socket, "LOGIN", "rate-limited");
      const { name, password } = z.object({ name: z.string().min(1).max(24), password: z.string().min(1).max(128) }).parse(raw);
      const key = `${ip}:${name.trim().toLowerCase()}`;
      const fails = loginFails.get(key) ?? 0;
      if (fails > 0) await new Promise((r) => setTimeout(r, Math.min(2 ** Math.min(fails, 5) * 500, 10_000)));
      try {
        const { userId, displayName } = loginUser(store, name, password);
        loginFails.delete(key);
        linkSession(store, sessionOrCreate(socket), userId);
        socket.emit("LOGGED_IN", { userId, displayName });
      } catch {
        const n = fails + 1;
        loginFails.set(key, n);
        if (n === 5) store.secEvent("login-bruteforce", key.slice(0, 80));
        safeError(socket, "LOGIN", "bad-credentials");
      }
    } catch {
      safeError(socket, "LOGIN", "invalid-payload");
    }
  });

  socket.on("MY_PROFILE", () => {
    try {
      const sid = requireSession(socket);
      const u = userOfSession(store, sid);
      if (!u) return safeError(socket, "MY_PROFILE", "guest");
      socket.emit("PROFILE", profileOf(store, u.userId));
    } catch (e) {
      safeError(socket, "MY_PROFILE", errOf(e));
    }
  });

  socket.on("DELETE_ACCOUNT", (raw: unknown) => {
    try {
      const ip = clientIp(socket);
      if (!rlAuth.take(ip)) return safeError(socket, "DELETE_ACCOUNT", "rate-limited");
      const sid = requireSession(socket);
      const u = userOfSession(store, sid);
      if (!u) return safeError(socket, "DELETE_ACCOUNT", "guest");
      const { password } = z.object({ password: z.string().min(1).max(128) }).parse(raw);
      const row = store.db.prepare("SELECT pass_hash FROM users WHERE id=?").get(u.userId) as { pass_hash: string };
      if (!verifyPassword(password, row.pass_hash)) return safeError(socket, "DELETE_ACCOUNT", "bad-credentials");
      deleteAccount(store, u.userId);
      socket.emit("ACCOUNT_DELETED", {});
    } catch {
      safeError(socket, "DELETE_ACCOUNT", "invalid-payload");
    }
  });

  function requireAdmin(socket: Socket) {
    if (!ADMIN_TOKEN || socket.data.admin !== true) throw new EngineError("not-admin");
  }

  socket.on("ADMIN_AUTH", (raw: unknown) => {
    try {
      const { token } = z.object({ token: z.string().min(8).max(256) }).parse(raw);
      if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        store.secEvent("admin-auth-fail", clientIp(socket));
        return safeError(socket, "ADMIN_AUTH", "bad-credentials");
      }
      socket.data.admin = true;
      socket.emit("ADMIN_OK", {});
    } catch {
      safeError(socket, "ADMIN_AUTH", "invalid-payload");
    }
  });

  socket.on("ADMIN_REPORTS", () => {
    try {
      requireAdmin(socket);
      socket.emit("ADMIN_REPORTS", { reports: engine.listReports() });
    } catch (e) {
      safeError(socket, "ADMIN_REPORTS", errOf(e));
    }
  });

  socket.on("ADMIN_DISMISS", (raw: unknown) => {
    try {
      requireAdmin(socket);
      const { id } = z.object({ id: z.number().int() }).parse(raw);
      engine.dismissReport(id);
      socket.emit("ADMIN_DONE", {});
    } catch (e) {
      safeError(socket, "ADMIN_DISMISS", errOf(e));
    }
  });

  socket.on("ADMIN_BLOCK", (raw: unknown) => {
    try {
      requireAdmin(socket);
      const { text, reason } = z.object({ text: z.string().min(1).max(200), reason: z.string().max(200).default("") }).parse(raw);
      engine.blockQuestionText(text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(), reason);
      socket.emit("ADMIN_DONE", {});
    } catch (e) {
      safeError(socket, "ADMIN_BLOCK", errOf(e));
    }
  });
});

// boot recovery: cancel interrupted matches (refunding open stakes)
engine.recover();

httpServer.listen(PORT, () => {
  console.log(`minority-rule server on :${PORT}`);
});
