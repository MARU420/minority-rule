import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Play } from "lucide-react";
import { emit, ensureSession, getSocket } from "../net/server";
import type { PublicRoom } from "../net/types";

export function Lobby({ initialName = "", onStart }: { initialName?: string; onStart: (code: string, sessionId: string) => void }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [amHost, setAmHost] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const onRoom = (r: PublicRoom) => setRoom(r);
    const onStarted = () => {
      if (code) onStart(code, sessionId);
    };
    s.on("ROOM_UPDATED", onRoom);
    s.on("MATCH_STARTED", onStarted);
    s.on("SAFE_ERROR", (p: { message: string }) => setError(p.message));
    return () => {
      s.off("ROOM_UPDATED", onRoom);
      s.off("MATCH_STARTED", onStarted);
    };
  }, [code, sessionId, onStart]);

  async function create() {
    if (!name.trim()) return setError("enter-name");
    setBusy(true);
    setError("");
    try {
      const ses = await ensureSession(name.trim());
      setSessionId(ses.sessionId);
      const { code: c } = await emit<{ code: string }>("CREATE_ROOM", { displayName: name.trim(), settings: {} });
      setCode(c);
      setAmHost(true);
      const s = getSocket();
      s.emit("REQUEST_PUBLIC_MATCH_STATE", { code: c });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!name.trim() || !code.trim()) return setError("enter-name-and-code");
    setBusy(true);
    setError("");
    try {
      const ses = await ensureSession(name.trim());
      setSessionId(ses.sessionId);
      await emit("JOIN_ROOM", { code: code.trim().toUpperCase(), displayName: name.trim() });
      setCode(code.trim().toUpperCase());
      const s = getSocket();
      s.emit("REQUEST_PUBLIC_MATCH_STATE", { code: code.trim().toUpperCase() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ready(v: boolean) {
    setError("");
    getSocket().emit("READY_UP", { code, ready: v });
  }

  async function start() {
    try {
      getSocket().emit("START_MATCH", { code });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!room) {
    return (
      <div className="panel bg-white p-6 text-[#0A0A0A]">
        <div className="font-display text-xl">ONLINE LOBBY</div>
        <p className="mt-1 text-sm text-neutral-600">Real multiplayer on the authoritative server. Bots fill empty seats.</p>
        <label className="mt-4 block text-xs font-black tracking-widest">DISPLAY NAME</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Akiyama"
          className="mt-1 w-full border-[3px] border-black px-3 py-2.5 text-sm font-bold outline-none" />
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button disabled={busy} onClick={create} className="flex flex-1 items-center justify-center gap-2 border-4 border-black bg-[#0A0A0A] p-3 font-display text-sm text-white disabled:opacity-40">
            <Play className="h-4 w-4" /> CREATE ROOM
          </button>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="CODE"
            className="flex-1 border-[3px] border-black px-3 py-2.5 text-center font-display tracking-[0.3em] outline-none" />
          <button disabled={busy} onClick={join} className="flex flex-1 items-center justify-center gap-2 border-4 border-black bg-[#E10600] p-3 font-display text-sm text-white disabled:opacity-40">
            <ArrowRight className="h-4 w-4" /> JOIN
          </button>
        </div>
        {error && <div className="mt-3 border-[3px] border-[#E10600] bg-red-50 px-3 py-2 text-sm font-bold text-[#E10600]">{error}</div>}
      </div>
    );
  }

  return (
    <div className="panel bg-white p-6 text-[#0A0A0A]">
      <div className="flex items-center justify-between">
        <div className="font-display text-xl">ROOM <span className="text-[#E10600]">{room.code}</span></div>
        <button onClick={() => { void navigator.clipboard?.writeText(room.code); }} className="flex items-center gap-1 border-[3px] border-black px-2 py-1 text-xs font-black">
          <Copy className="h-3 w-3" /> COPY
        </button>
      </div>
      <p className="mt-1 text-sm text-neutral-600">
        {room.participants.length}/{room.settings.targetParticipants} players · stake {room.settings.stake} · start {room.settings.startingBalance}
      </p>
      <div className="mt-4 space-y-2">
        {room.participants.map((p) => (
          <div key={p.id} className="flex items-center justify-between border-[3px] border-black px-3 py-2 text-sm font-bold">
            <span>{p.name} {p.kind === "BOT" ? <em className="not-italic text-neutral-500">[BOT]</em> : null}
              {!p.connected ? <em className="not-italic text-[#E10600]"> · off</em> : null}</span>
            <span className="flex items-center gap-1 text-xs">{p.ready ? <><Check className="h-4 w-4 text-green-700" /> READY</> : "WAITING"}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button onClick={() => ready(true)} className="flex-1 border-[3px] border-black bg-[#0A0A0A] p-3 font-display text-sm text-white">READY</button>
        <button onClick={() => ready(false)} className="flex-1 border-[3px] border-black bg-white p-3 font-display text-sm">UNREADY</button>
        {amHost && (
          <button onClick={start} className="flex-1 border-[3px] border-black bg-[#E10600] p-3 font-display text-sm text-white shadow-[4px_4px_0_#000]">
            START ({room.settings.minParticipants}+)
          </button>
        )}
      </div>
      {error && <div className="mt-3 border-[3px] border-[#E10600] bg-red-50 px-3 py-2 text-sm font-bold text-[#E10600]">{error}</div>}
      <p className="mt-3 text-xs text-neutral-500">Host starts when {room.settings.minParticipants}+ humans joined. Bots fill to {room.settings.targetParticipants}. Questions are submitted after start.</p>
    </div>
  );
}
