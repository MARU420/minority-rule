import { useState } from "react";

const KEY = "minority-consent";

export function loadConsent(): "accepted" | "declined" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return "declined";
  }
}

/**
 * This game sets NO tracking cookies and uses NO analytics.
 * localStorage holds: session token (strictly necessary to play),
 * display name, sound setting, consent choice, past-match history.
 * Declining disables the optional history only.
 */
export function CookieBanner({ onChoice }: { onChoice: (v: "accepted" | "declined") => void }) {
  const [show, setShow] = useState(() => loadConsent() === null);
  const [details, setDetails] = useState(false);
  if (!show) return null;

  function choose(v: "accepted" | "declined") {
    try {
      localStorage.setItem(KEY, v);
      if (v === "declined") localStorage.removeItem("minority-past");
    } catch {
      /* storage unavailable */
    }
    setShow(false);
    onChoice(v);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t-4 border-black bg-white p-4 text-[#0A0A0A]">
      <div className="mx-auto max-w-5xl">
        <b className="font-display text-sm tracking-wider">COOKIES & DATA — NO TRACKING HERE</b>
        <p className="mt-1 text-[13px]">
          No ads, no analytics, no third-party cookies. We store only what the game needs
          (session, name, settings{details && ", match history"}).
        </p>
        {details && (
          <p className="mt-1 text-xs text-neutral-600">
            Strictly necessary: session token, display name, sound setting. Optional: past-match
            history on this device. Accounts (if you register): name + salted password hash +
            match stats on our server. Questions, votes, and chat are match data, kept per the
            Privacy Policy. Under 13? Don't play without a parent.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => choose("accepted")} className="border-[3px] border-black bg-[#0A0A0A] px-4 py-2 font-display text-xs text-white">ACCEPT</button>
          <button onClick={() => choose("declined")} className="border-[3px] border-black bg-white px-4 py-2 font-display text-xs">DECLINE (history off)</button>
          <button onClick={() => setDetails((d) => !d)} className="px-2 py-2 text-xs font-bold underline">details</button>
        </div>
      </div>
    </div>
  );
}
