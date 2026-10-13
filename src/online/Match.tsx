import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, Flag, Send, Volume2, VolumeX, Zap } from "lucide-react";
import { emit, getSocket } from "../net/server";
import type { PublicRoom } from "../net/types";
import { SuitPortrait } from "../components/PlayerCard";
import { isMuted, setMuted, sfx } from "../fx/sound";
import { ChipGraph, type HistoryPoint } from "./Graph";

interface Me {
  id: string;
  balance: number;
  hasVoted: boolean;
  myVote: "YES" | "NO" | null;
}
interface RoundQ {
  text: string;
  author?: string;
}
interface LastResult {
  round: number;
  yes: number;
  no: number;
  minority: "YES" | "NO" | null;
  pot: number;
  votes: { pid: string; vote: "YES" | "NO" }[];
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 10;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Match({ code }: { code: string }) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [question, setQuestion] = useState<RoundQ | null>(null);
  const [pot, setPot] = useState(0);
  const [voted, setVoted] = useState(0);
  const [votedTotal, setVotedTotal] = useState(0);
  const [result, setResult] = useState<LastResult | null>(null);
  const [chat, setChat] = useState<{ from: string; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [qDone, setQDone] = useState(false);
  const [subCount, setSubCount] = useState({ submitted: 0, total: 0 });
  const [error, setError] = useState("");
  const [myPick, setMyPick] = useState<"YES" | "NO" | null>(null);
  const [muted, setM] = useState(isMuted());
  const [pending, setPending] = useState<LastResult | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const savedRef = useRef(false);
  const myVoteRef = useRef<"YES" | "NO" | null>(null);
  myVoteRef.current = myPick ?? me?.myVote ?? null;

  useEffect(() => {
    const s = getSocket();
    const onRoom = (r: PublicRoom) => setRoom(r);
    const onState = (p: { room: PublicRoom; me: Me; current: RoundQ | null }) => {
      setRoom(p.room);
      setMe(p.me);
      if (p.current) setQuestion(p.current);
    };
    const onRoundStarted = (p: { question?: RoundQ; pot?: number; voting?: boolean }) => {
      if (p.question) {
        setQuestion(p.question);
        setResult(null);
        setPending(null);
        setMyPick(null);
      }
      if (typeof p.pot === "number") setPot(p.pot);
      if (p.voting) sfx.round();
    };
    const onVoteStatus = (p: { voted: number; total: number }) => {
      setVoted(p.voted);
      setVotedTotal(p.total);
    };
    const onResolved = (r: LastResult) => {
      setPending(r); // reveal drama: hold 1.4s before showing
      sfx.revealDrum();
    };
    const onChat = (m: { from: string; text: string }) => setChat((c) => [...c.slice(-49), m]);
    const onSub = (p: { submitted: number; total: number }) => setSubCount(p);
    const onErr = (p: { message: string }) => setError(p.message);
    s.on("ROOM_UPDATED", onRoom);
    s.on("PUBLIC_MATCH_STATE", onState);
    s.on("ROUND_STARTED", onRoundStarted);
    s.on("VOTE_STATUS_UPDATED", onVoteStatus);
    s.on("ROUND_RESOLVED", onResolved);
    s.on("CHAT_MESSAGE", onChat);
    s.on("SUBMISSION_STATUS_UPDATED", onSub);
    s.on("SAFE_ERROR", onErr);
    s.emit("REQUEST_PUBLIC_MATCH_STATE", { code });
    return () => {
      s.off("ROOM_UPDATED", onRoom);
      s.off("PUBLIC_MATCH_STATE", onState);
      s.off("ROUND_STARTED", onRoundStarted);
      s.off("VOTE_STATUS_UPDATED", onVoteStatus);
      s.off("ROUND_RESOLVED", onResolved);
      s.off("CHAT_MESSAGE", onChat);
      s.off("SUBMISSION_STATUS_UPDATED", onSub);
      s.off("SAFE_ERROR", onErr);
    };
  }, [code]);

  const now = useNow(!!room?.deadlineMs && (room.state === "VOTING_OPEN" || room.state === "QUESTION_SUBMISSION"));
  const secsLeft = room?.deadlineMs ? Math.max(0, Math.ceil((room.deadlineMs - now) / 1000)) : null;

  // reveal drama timer
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setResult(pending);
      const mine = myVoteRef.current;
      if (pending.minority === null) sfx.tick();
      else if (mine && mine === pending.minority) sfx.win();
      else sfx.lose();
      setPending(null);
    }, 1400);
    return () => clearTimeout(t);
  }, [pending]);

  // countdown beeps (display only — server owns the deadline)
  const lastBeep = useRef(-1);
  useEffect(() => {
    if (room?.state === "VOTING_OPEN" && secsLeft !== null && secsLeft <= 5 && secsLeft > 0 && lastBeep.current !== secsLeft) {
      lastBeep.current = secsLeft;
      sfx.countdown();
    }
    if (secsLeft === null) lastBeep.current = -1;
  }, [secsLeft, room?.state]);

  // chip history for the graph
  useEffect(() => {
    if (!room || room.leaderboard.length === 0) return;
    setHistory((h) => {
      const balances: Record<string, number> = {};
      for (const l of room.leaderboard) balances[l.participantId] = l.balance;
      const last = h[h.length - 1];
      if (last && last.round === room.round && JSON.stringify(last.balances) === JSON.stringify(balances)) return h;
      if (h.length === 0) {
        const start: Record<string, number> = {};
        for (const l of room.leaderboard) start[l.participantId] = room.settings.startingBalance;
        return [{ round: 0, balances: start }, { round: room.round, balances }];
      }
      return [...h.slice(-12), { round: room.round, balances }];
    });
  }, [room]);

  // persist match result once for the main-menu history
  useEffect(() => {
    if (!room || savedRef.current) return;
    if (room.state !== "MATCH_COMPLETED" && room.state !== "MATCH_RESULTS") return;
    if (!me || room.leaderboard.length === 0) return;
    savedRef.current = true;
    const rank = room.leaderboard.findIndex((l) => l.participantId === me.id) + 1;
    const entry = {
      date: Date.now(),
      rank,
      of: room.leaderboard.length,
      balance: me.balance,
      wins: room.leaderboard.find((l) => l.participantId === me.id)?.minorityWins ?? 0,
    };
    try {
      const past = JSON.parse(localStorage.getItem("minority-past") ?? "[]") as unknown[];
      localStorage.setItem("minority-past", JSON.stringify([entry, ...past].slice(0, 10)));
    } catch {
      /* storage unavailable */
    }
  }, [room, me]);

  const voteMap = useMemo(() => new Map((result?.votes ?? []).map((v) => [v.pid, v.vote])), [result]);
  const revealed = !pending && (room?.state === "ROUND_RESULTS" || room?.state === "MATCH_RESULTS" || room?.state === "MATCH_COMPLETED");
  const names = useMemo(() => Object.fromEntries((room?.participants ?? []).map((p) => [p.id, p.name])), [room]);
  const iWon = result && me && result.minority ? voteMap.get(me.id) === result.minority : null;

  async function doVote(v: "YES" | "NO") {
    setError("");
    setMyPick(v);
    sfx.vote();
    try {
      await emit("SUBMIT_VOTE", { code, vote: v });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submitQ() {
    if (!qDraft.trim()) return;
    setError("");
    sfx.click();
    try {
      await emit("SUBMIT_QUESTION", { code, text: qDraft.trim() });
      setQDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function sendChat() {
    if (!draft.trim()) return;
    getSocket().emit("CHAT_MESSAGE", { code, text: draft.trim().slice(0, 300) });
    setDraft("");
  }
  async function report() {
    try {
      await emit("REPORT_CONTENT", { code, reason: "reported from match screen" });
      setError("report-sent");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!room) return <div className="panel bg-white p-6 text-black">Connecting to room {code}…</div>;
  const stake = room.settings.stake;

  return (
    <div className="panel bg-white text-[#0A0A0A]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-4 border-black bg-[#0A0A0A] px-6 py-4 text-white">
        <h1 className="font-display text-2xl tracking-wide">MINORITY <span className="text-[#E10600]">RULE</span></h1>
        <div className="flex items-center gap-2">
          <button onClick={() => { const m = !muted; setM(m); setMuted(m); }} className="border-2 border-white px-2 py-1 text-white" title="sound">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <div className="skew-tag flex items-center gap-1 bg-white px-3 py-1 text-[13px] font-black text-black">
            <Zap className="h-4 w-4 text-[#E10600]" /> STAKE {stake}
          </div>
          <div className="skew-tag bg-[#E10600] px-3 py-1 text-[13px] font-black">ROUND {room.round} / {room.totalRounds}</div>
          {secsLeft !== null && <div className="skew-tag bg-black px-3 py-1 text-[13px] font-black">{secsLeft}s</div>}
        </div>
      </header>

      <div className="flex items-center gap-3 border-b-[3px] border-black px-6 py-3 text-sm">
        <b className="skew-tag bg-[#0A0A0A] px-2 py-0.5 text-white">{room.state.replace(/_/g, " ")}</b>
        <span className="flex-1">
          {room.state === "QUESTION_SUBMISSION" && `Each player submits one YES/NO question — ${subCount.submitted}/${subCount.total || room.total} in. No peeking.`}
          {room.state === "VOTING_OPEN" && `Vote now — minority takes pot ${pot}. ${voted}/${votedTotal} voted.`}
          {pending && <b className="anim-flash px-2 text-[#E10600]">REVEALING…</b>}
          {!pending && room.state === "ROUND_RESULTS" && result && (result.minority ? `${result.yes}Y/${result.no}N → ${result.minority} splits ${result.pot}.` : `${result.yes}/${result.no} TIE — stakes refunded.`)}
          {(room.state === "MATCH_COMPLETED" || room.state === "MATCH_RESULTS") && "Match over. Final standings below."}
        </span>
      </div>

      {room.state === "QUESTION_SUBMISSION" && !qDone && (
        <div className="border-b-[3px] border-black bg-neutral-100 p-6">
          <b className="font-display text-sm tracking-wider">SUBMIT YOUR QUESTION (one per match, locked forever)</b>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} maxLength={200} placeholder="YES/NO question…"
              className="flex-1 border-[3px] border-black px-3 py-2.5 text-sm outline-none" />
            <button onClick={submitQ} className="border-[3px] border-black bg-[#0A0A0A] px-5 py-2.5 font-display text-sm text-white">SUBMIT</button>
          </div>
        </div>
      )}

      {question && room.state !== "QUESTION_SUBMISSION" && room.state !== "WAITING_FOR_PLAYERS" && (
        <div className="border-b-[3px] border-black bg-[#0A0A0A] px-6 py-4 text-white">
          <div className="text-[11px] font-black tracking-[0.2em] text-[#E10600]">THE QUESTION · ROUND {room.round}</div>
          <div className="mt-1 font-display text-xl leading-snug">“{question.text}”</div>
          {question.author && <div className="mt-1 text-[13px] text-neutral-400">Pitched by {question.author}</div>}
          <button onClick={report} className="mt-2 flex items-center gap-1 text-xs text-neutral-500 hover:text-white"><Flag className="h-3 w-3" /> report</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-5">
        {room.participants.map((p, i) => {
          const isMe = me?.id === p.id;
          const v = revealed ? voteMap.get(p.id) : null;
          const label = revealed ? (v ?? "—") : isMe ? (me?.hasVoted || myPick ? "● ● ●" : "—") : "—";
          const bal = room.leaderboard.find((l) => l.participantId === p.id)?.balance;
          const cardAnim = revealed && isMe ? (iWon === true ? "anim-pop" : iWon === false ? "anim-shake" : "") : "";
          return (
            <div key={p.id} className={`ticket bg-white ${isMe ? "ticket-you" : ""} ${cardAnim}`}>
              <div className="halftone-dark relative flex h-28 items-center justify-center border-b-[3px] border-black">
                <span className="skew-tag absolute top-1.5 left-1.5 border-2 border-black bg-[#0A0A0A] px-2 py-0.5 text-[11px] font-black text-white">#{String(i).padStart(2, "0")}</span>
                {isMe && <span className="skew-tag absolute top-1.5 right-1.5 border-2 border-black bg-[#E10600] px-2 py-0.5 text-[11px] font-black text-white">YOU</span>}
                <SuitPortrait id={hashId(p.id)} />
              </div>
              <div className="p-2">
                <b className="block truncate text-[13px]">{p.name}{p.kind === "BOT" ? <span className="text-neutral-500"> [BOT]</span> : null}</b>
                <div key={bal ?? "x"} className="anim-pop text-[12px] font-black">{bal ?? "…"}</div>
                <div className={`mt-2 border-[3px] border-black p-1.5 text-center font-display text-sm ${revealed ? "anim-flip" : ""} ${label === "YES" ? "bg-white" : label === "NO" ? "bg-[#E10600] text-white" : "bg-[#0A0A0A] text-white"}`}>{label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {room.state === "VOTING_OPEN" && (
        <footer className="flex flex-col gap-3 px-6 pb-6 sm:flex-row">
          <button onClick={() => doVote("YES")} className={`flex-1 border-4 border-black p-4 font-display text-lg transition-transform active:scale-95 ${myPick === "YES" || me?.myVote === "YES" ? "bg-[#0A0A0A] text-white" : "bg-white hover:bg-black hover:text-white"}`}>
            <Check className="mr-2 inline h-5 w-5" /> YES
          </button>
          <button onClick={() => doVote("NO")} className={`flex-1 border-4 border-black p-4 font-display text-lg transition-transform active:scale-95 ${myPick === "NO" || me?.myVote === "NO" ? "bg-[#E10600] text-white" : "bg-white hover:bg-[#E10600] hover:text-white"}`}>
            <Check className="mr-2 inline h-5 w-5" /> NO
          </button>
          <div className="flex flex-1 items-center justify-center gap-2 border-4 border-black bg-neutral-100 p-4 font-display text-sm">
            <Eye className="h-4 w-4" /> {me?.hasVoted ? "VOTE LOCKED IN" : "PICK A SIDE"}
          </div>
        </footer>
      )}

      {room.state === "ROUND_RESULTS" && (
        <div className="px-6 pb-6">
          <button onClick={() => { sfx.click(); getSocket().emit("READY_NEXT", { code }); }} className="w-full border-4 border-black bg-[#E10600] p-4 font-display text-lg text-white shadow-[5px_5px_0_#000] transition-transform active:scale-[0.98]">READY — NEXT</button>
        </div>
      )}

      {history.length >= 2 && (
        <div className="mx-6 mb-4 border-[3px] border-black bg-white p-3">
          <b className="font-display text-xs tracking-wider">CHIP HISTORY</b>
          <ChipGraph history={history} names={names} meId={me?.id ?? null} />
        </div>
      )}

      {room.leaderboard.length > 0 && (
        <div className="mx-6 mb-4 border-[3px] border-black">
          {room.leaderboard.map((l, i) => (
            <div key={l.participantId} className={`flex justify-between px-4 py-2 text-sm font-bold ${i === 0 ? "bg-[#0A0A0A] text-white" : "bg-white"}`}>
              <span>#{i + 1} {l.displayName} · {l.minorityWins}W</span>
              <span className={i === 0 ? "text-[#E10600]" : ""}>{l.balance >= 0 ? `+${l.balance}` : l.balance} ({l.net >= 0 ? `+${l.net}` : l.net})</span>
            </div>
          ))}
        </div>
      )}

      <div className="mx-6 mb-6 border-[3px] border-black">
        <div className="max-h-32 space-y-1 overflow-y-auto bg-neutral-100 p-3 text-[13px]">
          {chat.map((m, i) => <div key={i}><b>{m.from}: </b>{m.text}</div>)}
        </div>
        <div className="flex gap-2 border-t-[3px] border-black p-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} maxLength={300}
            placeholder="Table talk…" className="flex-1 border-[3px] border-black px-2 py-1.5 text-sm outline-none" />
          <button onClick={sendChat} className="border-[3px] border-black bg-black px-3 text-white"><Send className="h-4 w-4" /></button>
        </div>
      </div>
      {error && <div className="mx-6 mb-6 border-[3px] border-[#E10600] px-3 py-2 text-sm font-bold text-[#E10600]">{error}</div>}
    </div>
  );
}
