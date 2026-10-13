import { io, type Socket } from "socket.io-client";

const URL = (import.meta.env.VITE_SERVER_URL as string) || "http://localhost:8081";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(URL, { transports: ["websocket"] });
  }
  return socket;
}

export interface Session {
  sessionId: string;
  token: string;
}

const KEY = "minority-rule-session";

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function emit<T>(event: string, payload: unknown): Promise<T> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    const ok = (p: T) => {
      cleanup();
      resolve(p);
    };
    const fail = (p: { event: string; message: string }) => {
      if (p.event !== event) return;
      cleanup();
      reject(new Error(p.message));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 8000);
    const cleanup = () => {
      clearTimeout(timer);
      s.off(eventToAck(event), ok as never);
      s.off("SAFE_ERROR", fail);
    };
    s.on(eventToAck(event), ok as never);
    s.on("SAFE_ERROR", fail);
    s.emit(event, payload);
  });
}

function eventToAck(event: string): string {
  switch (event) {
    case "ISSUE_SESSION":
      return "SESSION_ISSUED";
    case "AUTHENTICATE":
      return "AUTHENTICATED";
    case "CREATE_ROOM":
      return "ROOM_CREATED";
    case "JOIN_ROOM":
      return "ROOM_JOINED";
    case "SUBMIT_QUESTION":
      return "QUESTION_ACCEPTED";
    case "SUBMIT_VOTE":
      return "VOTE_ACCEPTED";
    case "REPORT_CONTENT":
      return "REPORT_RECEIVED";
    default:
      return `${event}_ACK`;
  }
}

export async function ensureSession(displayName: string): Promise<Session> {
  const s = getSocket();
  const saved = loadSession();
  if (saved) {
    try {
      await emit("AUTHENTICATE", saved);
      return saved;
    } catch {
      localStorage.removeItem(KEY);
    }
  }
  const fresh = await emit<Session>("ISSUE_SESSION", { displayName });
  saveSession(fresh);
  s.emit("AUTHENTICATE", fresh);
  return fresh;
}
