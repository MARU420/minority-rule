import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Eye, Check, Zap, MessageCircle, Send, ArrowRight, PenLine, Dices } from "lucide-react";
import {
  TOTAL_ROUNDS,
  createPlayers,
  resolveRound,
  stakeForRound,
  type Phase,
  type Player,
  type RoundResult,
  type Vote,
} from "./game/engine";
import { botVote } from "./game/bots";
import { QUESTIONS, ambientLine, botReply, type Question } from "./game/talk";
import { questionForRound, randomBotQuestions, type RoundQuestion } from "./game/questions";
import { PlayerCard } from "./components/PlayerCard";
import { sfx, startBgm, stopBgm } from "./fx/sound";

interface ChatMsg {
  from: string;
  text: string;
  mine?: boolean;
}

interface Submission {
  from: string;
  text: string;
  mine?: boolean;
}

export default function App() {
  const [players, setPlayers] = useState<Player[]>(createPlayers);
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<Phase>("submit");
  const [yourVote, setYourVote] = useState<Vote | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [lastMinority, setLastMinority] = useState<Vote | null>(null);
  const [suddenDeath, setSuddenDeath] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [askBot, setAskBot] = useState(1);
  const [askQ, setAskQ] = useState<Question["id"]>("which-side");
  const [subs, setSubs] = useState<Submission[]>([]);
  const [draft, setDraft] = useState("");
  const [currentQ, setCurrentQ] = useState<RoundQuestion>(questionForRound(1));

  const intendedRef = useRef<Map<number, Vote>>(new Map());
  const lastMinorityRef = useRef<Vote | null>(null);
  const roundRef = useRef(1);
  lastMinorityRef.current = lastMinority;
  roundRef.current = round;

  useEffect(() => {
    startBgm("match");
    return () => stopBgm();
  }, []);

  // result sting after reveal
  useEffect(() => {
    if (phase !== "reveal" || !result) return;
    const t = setTimeout(() => {
      if (result.minority === null) sfx.tick();
      else if (yourVote && yourVote === result.minority) sfx.win();
      else sfx.lose();
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result]);

  /** Submit phase: everyone pitches a YES/NO question. Host (you) picks one. */
  const startSubmit = useCallback((plist: Player[]) => {
    setPlayers(plist.map((p) => ({ ...p, vote: null })));
    setYourVote(null);
    setResult(null);
    setSuddenDeath(false);
    setDraft("");
    const bots = plist.filter((p) => !p.isYou);
    const botQs = randomBotQuestions(3);
    const openers = [...bots].sort(() => Math.random() - 0.5).slice(0, 3);
    setSubs(openers.map((b, i) => ({ from: b.name, text: botQs[i] })));
    setPhase("submit");
  }, []);

  /** Talk phase: bots pre-commit hidden votes + open with taunts. */
  const startTalk = useCallback(
    (plist: Player[], lastMin: Vote | null, isSD: boolean, q: RoundQuestion) => {
      const intended = new Map<number, Vote>();
      for (const p of plist) {
        if (!p.isYou && !p.eliminated) intended.set(p.id, botVote(p, lastMin));
      }
      intendedRef.current = intended;
      setPlayers(plist.map((p) => ({ ...p, vote: null })));
      setYourVote(null);
      setResult(null);
      setSuddenDeath(isSD);
      setCurrentQ(q);
      setPhase("talk");
      const bots = plist.filter((p) => !p.isYou);
      const openers = [...bots].sort(() => Math.random() - 0.5).slice(0, 3);
      setChat(openers.map((b) => ({ from: b.name, text: ambientLine(b, intended.get(b.id) ?? "YES") })));
    },
    [],
  );

  useEffect(() => {
    startSubmit(createPlayers());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enterVote() {
    setPlayers((prev) =>
      prev.map((p) => (p.isYou ? p : { ...p, vote: intendedRef.current.get(p.id) ?? p.vote })),
    );
    setPhase("vote");
  }

  function reveal() {
    if (phase !== "vote" || !yourVote) return;
    sfx.revealDrum();
    setPlayers((current) => {
      const fixed = current.map((p) => {
        if (p.vote) return p;
        if (p.isYou) return { ...p, vote: "YES" as Vote };
        return { ...p, vote: intendedRef.current.get(p.id) ?? botVote(p, lastMinorityRef.current) };
      });
      const { players: next, result: r } = resolveRound(fixed, roundRef.current);
      setResult(r);
      setPhase("reveal");
      if (r.minority) {
        lastMinorityRef.current = r.minority;
        setLastMinority(r.minority);
        setSuddenDeath(false);
      } else {
        setSuddenDeath(true);
      }
      return next;
    });
  }

  function pickRandomSub() {
    sfx.click();
    const pool = subs.length > 0 ? subs : [{ from: "HOUSE", text: questionForRound(roundRef.current).text }];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    startTalk(
      players.map((p) => ({ ...p, vote: null })),
      lastMinority,
      false,
      { text: pick.text, sub: `Pitched by ${pick.from}.` },
    );
  }

  function submitQuestion() {
    const text = draft.trim();
    if (!text) return;
    sfx.click();
    setSubs((s) => [...s, { from: "YOU", text, mine: true }]);
    setDraft("");
  }

  function pickSubmission(s: Submission) {
    sfx.click();
    startTalk(
      players.map((p) => ({ ...p, vote: null })),
      lastMinority,
      false,
      { text: s.text, sub: `Pitched by ${s.from}. Minority wins.` },
    );
  }

  function castVote(vote: Vote) {
    if (phase !== "vote") return;
    sfx.vote();
    setYourVote(vote);
    setPlayers((prev) => prev.map((p) => (p.isYou ? { ...p, vote } : p)));
  }

  function ask() {
    const bot = players.find((p) => p.id === askBot);
    if (!bot || phase !== "talk") return;
    sfx.click();
    const q = QUESTIONS.find((x) => x.id === askQ)!;
    const intended = intendedRef.current.get(bot.id) ?? "YES";
    setChat((c) => [
      ...c,
      { from: "YOU", text: `${bot.name} — ${q.label}`, mine: true },
      { from: bot.name, text: botReply(bot, q.id, intended, players) },
    ]);
  }

  function advance() {
    if (phase === "submit") {
      pickRandomSub();
      return;
    }
    if (phase === "talk") {
      sfx.round();
      enterVote();
      return;
    }
    if (phase === "reveal" && result && result.minority === null) {
      sfx.click();
      const next = players.map((p) => {
        if (p.isYou) return { ...p, vote: null };
        return { ...p, vote: botVote(p, lastMinorityRef.current) };
      });
      const m = new Map<number, Vote>();
      for (const p of next) if (!p.isYou && p.vote) m.set(p.id, p.vote);
      intendedRef.current = m;
      setPlayers(next.map((p) => (p.isYou ? p : { ...p, vote: null })));
      setYourVote(null);
      setResult(null);
      setPhase("vote");
      return;
    }
    if (round >= TOTAL_ROUNDS) {
      sfx.win();
      setPhase("gameover");
      return;
    }
    sfx.round();
    setRound((r) => r + 1);
    startSubmit(players.map((p) => ({ ...p, vote: null })));
  }

  function reset() {
    sfx.click();
    setRound(1);
    setLastMinority(null);
    lastMinorityRef.current = null;
    startSubmit(createPlayers());
  }

  const stake = stakeForRound(round);
  const isTie = phase === "reveal" && result && result.minority === null;
  const sorted = [...players].sort((a, b) => b.coins - a.coins);
  const youWon = phase === "gameover" && sorted[0]?.isYou;
  const phaseLabel =
    phase === "submit" ? "SUBMIT" : phase === "talk" ? (suddenDeath ? "SUDDEN DEATH · TALK" : "TALK") : phase === "vote" ? "VOTE" : phase === "reveal" ? "RESULT" : "FINAL";

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <div className="halftone-bg pointer-events-none fixed inset-0 opacity-20" />
      <div className="relative w-full max-w-5xl">
        <div className="panel bg-white text-[#0A0A0A]">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b-4 border-black bg-[#0A0A0A] px-6 py-4 text-white">
            <h1 className="font-display text-2xl tracking-wide">
              MINORITY <span className="text-[#E10600]">RULE</span>
            </h1>
            <div className="flex items-center gap-2">
              <div className="skew-tag flex items-center gap-1 bg-white px-3 py-1 text-[13px] font-black tracking-widest text-black">
                <Zap className="h-4 w-4 text-[#E10600]" /> STAKE {stake}
              </div>
              <div className="skew-tag bg-[#E10600] px-3 py-1 text-[13px] font-black tracking-widest">
                ROUND {Math.min(round, TOTAL_ROUNDS)} / {TOTAL_ROUNDS}
                {suddenDeath && phase !== "reveal" ? " · SD" : ""}
              </div>
            </div>
          </header>

          <div className="flex items-center gap-3 border-b-[3px] border-black bg-white px-6 py-3 text-sm">
            <b className="skew-tag inline-block bg-[#0A0A0A] px-2 py-0.5 text-white">{phaseLabel}</b>
            <span className="flex-1">
              {phase === "submit" && "Pitch a YES/NO question. Take your time — press READY when the table agrees on one."}
              {phase === "talk" && "Grill them at your pace. Press TO VOTE when everyone is ready."}
              {phase === "vote" && `Vote on the question. Minority wins, majority pays ${stake} each. No rush.`}
              {phase === "reveal" &&
                result &&
                (result.minority
                  ? `${result.yesCount} YES vs ${result.noCount} NO → ${result.minority} splits ${(result.yesCount < result.noCount ? result.noCount : result.yesCount) * result.stake}.`
                  : `${result.yesCount} vs ${result.noCount} — TIE. Sudden-death revote.`)}
              {phase === "gameover" && (youWon ? "You finished top. The house pays." : "You lost. Debt remains.")}
            </span>
          </div>

          {phase !== "gameover" ? (
            <>
              {phase !== "submit" && (
                <div className="border-b-[3px] border-black bg-[#0A0A0A] px-6 py-4 text-white">
                  <div className="text-[11px] font-black tracking-[0.2em] text-[#E10600]">THE QUESTION · ROUND {round}</div>
                  <div className="mt-1 font-display text-xl leading-snug">“{currentQ.text}”</div>
                  <div className="mt-1 text-[13px] text-neutral-400">{currentQ.sub}</div>
                </div>
              )}

              {phase === "submit" && (
                <div className="border-b-[3px] border-black bg-neutral-100 p-6">
                  <div className="mb-3 flex items-center gap-2">
                    <PenLine className="h-4 w-4" />
                    <b className="font-display text-sm tracking-wider">PITCH A YES/NO QUESTION — NO TIMER</b>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submitQuestion()}
                      placeholder="e.g. Should the leader reveal first?"
                      className="flex-1 border-[3px] border-black bg-white px-3 py-2.5 text-sm font-medium outline-none"
                    />
                    <button onClick={submitQuestion} className="border-[3px] border-black bg-[#0A0A0A] px-5 py-2.5 font-display text-sm text-white">
                      SUBMIT
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {subs.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => pickSubmission(s)}
                        className={`flex w-full items-center justify-between gap-3 border-[3px] border-black bg-white px-4 py-2.5 text-left text-sm hover:bg-black hover:text-white ${s.mine ? "shadow-[4px_4px_0_#E10600]" : ""}`}
                      >
                        <span>
                          <b>{s.from}: </b>“{s.text}”
                        </span>
                        <span className="shrink-0 font-display text-xs">PLAY →</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={pickRandomSub} className="mt-4 flex w-full items-center justify-center gap-2 border-[3px] border-black bg-white px-4 py-3 font-display text-sm hover:bg-neutral-200">
                    <Dices className="h-4 w-4" /> READY — PICK RANDOM & START TALK
                  </button>
                  <p className="mt-3 text-xs text-neutral-500">No timer. Click a pitch to play it, or READY for a random pick. Multiplayer will wait for all-ready here.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-5 p-6 sm:grid-cols-5">
                {players.map((p) => (
                  <PlayerCard key={p.id} player={p} reveal={phase === "reveal"} />
                ))}
              </div>

              {phase === "talk" && (
                <div className="mx-6 mb-5 border-[3px] border-black">
                  <div className="flex items-center gap-2 border-b-[3px] border-black bg-black px-4 py-2 text-white">
                    <MessageCircle className="h-4 w-4 text-[#E10600]" />
                    <b className="font-display text-sm tracking-wider">INTERROGATION — NO TIMER</b>
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto bg-neutral-100 p-4 text-[13px]">
                    {chat.map((m, i) => (
                      <div key={i} className={m.mine ? "text-right" : ""}>
                        <b className={m.mine ? "text-[#E10600]" : ""}>{m.from}: </b>
                        <span className="font-medium">{m.text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 border-t-[3px] border-black bg-white p-3 sm:flex-row">
                    <select value={askBot} onChange={(e) => setAskBot(Number(e.target.value))} className="border-[3px] border-black bg-white px-2 py-2 text-sm font-bold">
                      {players.filter((p) => !p.isYou).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select value={askQ} onChange={(e) => setAskQ(e.target.value as Question["id"])} className="flex-1 border-[3px] border-black bg-white px-2 py-2 text-sm font-bold">
                      {QUESTIONS.map((q) => (
                        <option key={q.id} value={q.id}>{q.label}</option>
                      ))}
                    </select>
                    <button onClick={ask} className="flex items-center justify-center gap-1 border-[3px] border-black bg-[#0A0A0A] px-4 py-2 font-display text-sm text-white">
                      <Send className="h-4 w-4" /> ASK
                    </button>
                    <button onClick={advance} className="flex items-center justify-center gap-1 border-[3px] border-black bg-[#E10600] px-4 py-2 font-display text-sm text-white">
                      READY — TO VOTE <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {phase !== "talk" && phase !== "submit" && (
                <footer className="flex flex-col gap-3 px-6 pb-6 sm:flex-row">
                  {phase === "vote" ? (
                    <>
                      <button onClick={() => castVote("YES")} className={`flex-1 border-4 border-black p-4 font-display text-lg tracking-wide ${yourVote === "YES" ? "bg-[#0A0A0A] text-white" : "bg-white text-black hover:bg-black hover:text-white"}`}>
                        <Check className="mr-2 inline h-5 w-5" /> YES
                      </button>
                      <button onClick={() => castVote("NO")} className={`flex-1 border-4 border-black p-4 font-display text-lg tracking-wide ${yourVote === "NO" ? "bg-[#E10600] text-white" : "bg-white text-black hover:bg-[#E10600] hover:text-white"}`}>
                        <Check className="mr-2 inline h-5 w-5" /> NO
                      </button>
                      <button disabled={!yourVote} onClick={reveal} className="flex-1 border-4 border-black bg-[#E10600] p-4 font-display text-lg text-white shadow-[5px_5px_0_#000] disabled:opacity-40">
                        <Eye className="mr-2 inline h-5 w-5" /> READY — REVEAL
                      </button>
                    </>
                  ) : (
                    <button onClick={advance} className={`flex-1 border-4 border-black p-4 font-display text-lg text-white shadow-[5px_5px_0_#000] ${isTie ? "animate-pulse bg-black" : "bg-[#E10600]"}`}>
                      {isTie ? "⚡ SUDDEN-DEATH REVOTE" : round >= TOTAL_ROUNDS ? "FINAL RESULTS" : "READY — NEXT ROUND"}
                    </button>
                  )}
                </footer>
              )}
            </>
          ) : (
            <div className="p-6">
              <div className="border-[3px] border-black">
                {sorted.map((p, i) => (
                  <div key={p.id} className={`flex justify-between border-b-2 border-black px-4 py-2.5 text-sm font-bold last:border-b-0 ${i === 0 ? "bg-[#0A0A0A] text-white" : "bg-white"}`}>
                    <span>#{i + 1} {p.name}</span>
                    <span className={i === 0 ? "font-black text-[#E10600]" : ""}>{p.coins >= 0 ? `+${p.coins}` : p.coins}</span>
                  </div>
                ))}
              </div>
              <button onClick={reset} className="mt-5 flex w-full items-center justify-center gap-2 border-4 border-black bg-[#0A0A0A] p-4 font-display text-white">
                <RotateCcw className="h-5 w-5" /> NEW GAME
              </button>
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-xs tracking-widest text-neutral-500">
          NO TIMERS · SUBMIT → TALK → VOTE ON READY · MULTIPLAYER-READY
        </p>
      </div>
    </div>
  );
}
