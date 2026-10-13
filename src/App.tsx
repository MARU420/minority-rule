import { useState } from "react";
import { Globe, Bot, BookOpen, Settings2, Trophy, ChevronRight, Volume2, VolumeX } from "lucide-react";
import Practice from "./Practice";
import { Lobby } from "./online/Lobby";
import { Match } from "./online/Match";
import { MenuBackdrop } from "./components/MenuBackdrop";
import { isMuted, setMuted } from "./fx/sound";

export interface PastMatch {
  date: number;
  rank: number;
  of: number;
  balance: number;
  wins: number;
}

export function loadPast(): PastMatch[] {
  try {
    return JSON.parse(localStorage.getItem("minority-past") ?? "[]") as PastMatch[];
  } catch {
    return [];
  }
}

function HowTo({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["1 · PITCH", "Everyone submits one YES/NO question. Each is played exactly once."],
    ["2 · TALK", "Interrogate the table. Bots bluff — contrarians lie most."],
    ["3 · VOTE", "Vote YES or NO in secret. The minority takes the whole pot."],
    ["4 · TIE", "Equal votes = no minority. Stakes refunded, move on."],
    ["5 · WIN", "After N rounds (N = players), most chips wins. Nobody is eliminated."],
  ];
  return (
    <div className="panel anim-rise bg-white p-6 text-[#0A0A0A]">
      <div className="font-display text-xl">HOW TO PLAY</div>
      <div className="mt-3 space-y-2">
        {rows.map(([t, d]) => (
          <div key={t} className="border-[3px] border-black px-3 py-2 text-sm">
            <b className="font-display text-xs tracking-wider text-[#E10600]">{t}</b>
            <div className="font-medium">{d}</div>
          </div>
        ))}
      </div>
      <button onClick={onClose} className="mt-4 w-full border-4 border-black bg-[#0A0A0A] p-3 font-display text-sm text-white">GOT IT</button>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<"menu" | "online" | "practice">("menu");
  const [code, setCode] = useState("");
  const [playing, setPlaying] = useState(false);
  const [showHow, setShowHow] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [muted, setM] = useState(isMuted());
  const [name, setName] = useState(() => localStorage.getItem("minority-name") ?? "");
  const [past] = useState<PastMatch[]>(loadPast);

  function saveName(v: string) {
    setName(v);
    localStorage.setItem("minority-name", v);
  }

  if (mode === "practice") {
    return (
      <div className="relative min-h-screen p-6">
        <div className="halftone-bg pointer-events-none fixed inset-0 opacity-20" />
        <div className="relative">
          <Practice />
          <div className="mx-auto mt-4 max-w-5xl">
            <button onClick={() => setMode("menu")} className="text-xs tracking-widest text-neutral-500">← MAIN MENU</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      {mode === "menu" ? <MenuBackdrop /> : <div className="halftone-bg pointer-events-none fixed inset-0 opacity-20" />}
      <div className="relative w-full max-w-5xl">
        {mode === "menu" && !showHow && (
          <div className="panel bg-[#0A0A0A] p-8 text-center text-white">
            <div className="text-[11px] font-black tracking-[0.35em] text-[#E10600]">LIAR-GAME-INSPIRED · MINORITY WINS</div>
            <h1 className="mt-2 font-display text-5xl tracking-wide">MINORITY <span className="text-[#E10600]">RULE</span></h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-neutral-400">
              One question per player. Vote in secret. Stand alone, take the pot.
            </p>
            <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
              <button onClick={() => setMode("online")}
                className="group border-4 border-white bg-[#E10600] p-5 text-left text-white shadow-[6px_6px_0_#fff] transition-transform hover:-translate-y-0.5 active:scale-[0.98]">
                <Globe className="h-6 w-6" />
                <div className="mt-2 font-display text-xl">ONLINE MATCH <ChevronRight className="inline h-5 w-5 transition-transform group-hover:translate-x-1" /></div>
                <div className="text-xs opacity-80">Real players + bots · server-ruled chips</div>
              </button>
              <button onClick={() => setMode("practice")}
                className="group border-4 border-white bg-white p-5 text-left text-black shadow-[6px_6px_0_#E10600] transition-transform hover:-translate-y-0.5 active:scale-[0.98]">
                <Bot className="h-6 w-6" />
                <div className="mt-2 font-display text-xl">PRACTICE <ChevronRight className="inline h-5 w-5 transition-transform group-hover:translate-x-1" /></div>
                <div className="text-xs opacity-70">You vs 9 bots · offline, no stakes</div>
              </button>
            </div>
            <div className="mx-auto mt-3 flex max-w-2xl gap-3">
              <button onClick={() => setShowHow(true)} className="flex flex-1 items-center justify-center gap-2 border-[3px] border-neutral-600 p-3 font-display text-sm text-neutral-200 hover:border-white">
                <BookOpen className="h-4 w-4" /> HOW TO PLAY
              </button>
              <button onClick={() => setShowSettings((s) => !s)} className="flex flex-1 items-center justify-center gap-2 border-[3px] border-neutral-600 p-3 font-display text-sm text-neutral-200 hover:border-white">
                <Settings2 className="h-4 w-4" /> SETTINGS
              </button>
            </div>
            {showSettings && (
              <div className="anim-rise mx-auto mt-3 max-w-2xl border-[3px] border-neutral-600 p-4 text-left">
                <label className="text-xs font-black tracking-widest text-neutral-400">DISPLAY NAME</label>
                <input value={name} onChange={(e) => saveName(e.target.value)} maxLength={24} placeholder="e.g. Akiyama"
                  className="mt-1 w-full border-[3px] border-white bg-black px-3 py-2 text-sm font-bold text-white outline-none" />
                <button onClick={() => { const m = !muted; setM(m); setMuted(m); }}
                  className="mt-3 flex w-full items-center justify-center gap-2 border-[3px] border-white p-2.5 font-display text-sm">
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} SOUND {muted ? "OFF" : "ON"}
                </button>
              </div>
            )}
            {past.length > 0 && (
              <div className="mx-auto mt-3 max-w-2xl border-[3px] border-neutral-600 p-4 text-left">
                <div className="flex items-center gap-2 font-display text-sm text-neutral-200"><Trophy className="h-4 w-4 text-[#E10600]" /> RECENT MATCHES</div>
                <div className="mt-2 space-y-1">
                  {past.slice(0, 5).map((m, i) => (
                    <div key={i} className="flex justify-between text-xs font-bold text-neutral-300">
                      <span>#{m.rank}/{m.of} · {m.wins}W</span>
                      <span className={m.rank === 1 ? "text-[#E10600]" : ""}>{m.balance} chips · {new Date(m.date).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-4 text-[11px] tracking-[0.25em] text-neutral-600">TRUST NO ONE · MINORITY TAKES ALL</p>
          </div>
        )}
        {mode === "menu" && showHow && <HowTo onClose={() => setShowHow(false)} />}
        {mode === "online" && !playing && (
          <Lobby initialName={name} onStart={(c) => { setCode(c); setPlaying(true); }} />
        )}
        {mode === "online" && playing && <Match code={code} />}
        {mode !== "menu" && (
          <button onClick={() => { setMode("menu"); setPlaying(false); setShowHow(false); }} className="mt-4 text-xs tracking-widest text-neutral-500">← MAIN MENU</button>
        )}
      </div>
    </div>
  );
}
