import { useState } from "react";
import { emit, getSocket } from "../net/server";
import { sfx } from "../fx/sound";

interface Profile {
  id: string;
  name: string;
  matches: number;
  wins: number;
  minorityWins: number;
  netChips: number;
  bestRank: number;
}

export function AccountPanel({ onName }: { onName: (n: string) => void }) {
  const [user, setUser] = useState("");
  const [pw, setPw] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    sfx.click();
    try {
      const p = await emit<Profile>("MY_PROFILE", {});
      setProfile(p);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function register() {
    if (user.trim().length < 3 || pw.length < 8) return setError("name 3+ chars, password 8+ chars");
    sfx.click();
    setBusy(true);
    try {
      await emit("REGISTER", { name: user.trim(), password: pw });
      onName(user.trim());
      setPw("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    if (!user.trim() || !pw) return setError("enter name + password");
    sfx.click();
    setBusy(true);
    try {
      const r = await emit<{ displayName: string }>("LOGIN", { name: user.trim(), password: pw });
      onName(r.displayName);
      setPw("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-[3px] border-neutral-600 p-4 text-left">
      <b className="font-display text-sm tracking-wider text-neutral-200">ACCOUNT</b>
      {profile ? (
        <div className="mt-2">
          <div className="font-display text-lg text-white">{profile.name}</div>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            {[
              ["MATCHES", profile.matches],
              ["WINS", profile.wins],
              ["MINORITY", profile.minorityWins],
              ["NET CHIPS", profile.netChips >= 0 ? `+${profile.netChips}` : profile.netChips],
              ["BEST", profile.bestRank > 0 ? `#${profile.bestRank}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="border-2 border-neutral-600 px-1 py-2">
                <div className="text-[10px] font-black tracking-widest text-neutral-400">{k}</div>
                <div className="font-display text-base text-white">{v}</div>
              </div>
            ))}
          </div>
          <button onClick={refresh} className="mt-2 w-full border-2 border-neutral-600 p-2 font-display text-xs text-neutral-200">REFRESH</button>
        </div>
      ) : (
        <div className="mt-2">
          <div className="flex gap-2">
            <input value={user} onChange={(e) => setUser(e.target.value)} maxLength={24} placeholder="name"
              className="flex-1 border-[3px] border-white bg-black px-2 py-2 text-sm font-bold text-white outline-none" />
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" maxLength={128} placeholder="password 8+"
              className="flex-1 border-[3px] border-white bg-black px-2 py-2 text-sm font-bold text-white outline-none" />
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={busy} onClick={register} className="flex-1 border-[3px] border-white bg-[#E10600] p-2 font-display text-xs text-white disabled:opacity-40">REGISTER</button>
            <button disabled={busy} onClick={login} className="flex-1 border-[3px] border-white bg-black p-2 font-display text-xs text-white disabled:opacity-40">LOG IN</button>
          </div>
          <button
            onClick={() => {
              getSocket().emit("ISSUE_SESSION", { displayName: "Player" });
              setProfile(null);
            }}
            className="mt-2 w-full p-1 text-center text-[11px] text-neutral-500"
          >
            playing as guest — stats won't persist
          </button>
        </div>
      )}
      {error && error !== "guest" && <div className="mt-2 text-xs font-bold text-[#E10600]">{error}</div>}
      {error === "guest" && <div className="mt-2 text-xs text-neutral-500">Guest session — register to track stats.</div>}
    </div>
  );
}
