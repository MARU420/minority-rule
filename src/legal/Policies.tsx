export function Privacy({ onBack }: { onBack: () => void }) {
  const S = "mt-4 border-[3px] border-black bg-white p-4 text-left text-sm text-[#0A0A0A]";
  const H = "font-display text-sm tracking-wider text-[#E10600]";
  return (
    <div className="panel bg-white p-6">
      <div className="font-display text-2xl text-[#0A0A0A]">PRIVACY POLICY</div>
      <p className="text-xs text-neutral-500">Last updated October 2026 · Minority Rule hobby project</p>

      <div className={S}><div className={H}>1 · WHAT WE COLLECT</div>
        <ul className="mt-1 list-disc pl-5 font-medium">
          <li><b>Guest play:</b> random session token + display name. No email, no password.</li>
          <li><b>Accounts (optional):</b> display name, optional email (for future recovery), salted/scrypted password hash + match stats.</li>
          <li><b>Match data:</b> submitted questions, votes, chat messages, reports you file.</li>
          <li><b>On your device only:</b> sound setting, consent choice, optional match history.</li>
          <li><b>Never:</b> ads, analytics, trackers, third-party cookies, location, payments.</li>
        </ul>
      </div>
      <div className={S}><div className={H}>2 · WHY</div>
        <p className="font-medium">Solely to run matches: identity, scoring, leaderboards, reconnects, and abuse handling. Nothing is sold, shared, or used for marketing.</p>
      </div>
      <div className={S}><div className={H}>3 · RETENTION</div>
        <p className="font-medium">Match records persist for leaderboards and fairness audits. Delete your account any time (Settings → Account → Delete) — name, hash, and stats are removed and sessions revoked. Device data can be cleared via Decline in the cookie banner or your browser settings.</p>
      </div>
      <div className={S}><div className={H}>4 · YOUR RIGHTS (GDPR-style, everywhere)</div>
        <p className="font-medium">Access, correct, or delete your data: register an account so we can identify you, then request deletion in-app. Reports are reviewed by a human before action; blocklisted text is hashed-normalized, never linked publicly.</p>
      </div>
      <div className={S}><div className={H}>5 · CHILDREN</div>
        <p className="font-medium">Not directed at under-13s. Under 13 needs a parent. Under-16 needs parental consent in the EU/UK.</p>
      </div>
      <div className={S}><div className={H}>6 · SECURITY</div>
        <p className="font-medium">Passwords are salted + scrypt-hashed (never stored plain, min 8 chars with letter + number). Registration asks a small math captcha and is limited to 3 accounts/hour per network; logins slow down after failures. Sessions are unguessable tokens. Traffic is TLS-encrypted in production. No system is perfect — use a unique password.</p>
      </div>
      <div className={S}><div className={H}>7 · CONTACT</div>
        <p className="font-medium">Questions or deletion requests: use the in-game report flow or contact the operator listed on the repository page.</p>
      </div>
      <button onClick={onBack} className="mt-4 w-full border-4 border-black bg-[#0A0A0A] p-3 font-display text-sm text-white">← BACK</button>
    </div>
  );
}

export function Terms({ onBack }: { onBack: () => void }) {
  const S = "mt-4 border-[3px] border-black bg-white p-4 text-left text-sm text-[#0A0A0A]";
  const H = "font-display text-sm tracking-wider text-[#E10600]";
  return (
    <div className="panel bg-white p-6">
      <div className="font-display text-2xl text-[#0A0A0A]">TERMS OF SERVICE</div>
      <p className="text-xs text-neutral-500">Last updated October 2026 · play nice, lie in-game only</p>

      <div className={S}><div className={H}>1 · THE GAME</div>
        <p className="font-medium">Minority Rule is a free hobby game: vote YES/NO, minority takes the pot. Chips have no cash value, cannot be bought, sold, or cashed out. Ever.</p>
      </div>
      <div className={S}><div className={H}>2 · FAIR PLAY</div>
        <p className="font-medium">No bots-as-humans, no vote manipulation, no exploiting bugs, no flooding rooms. Outside-game vote coordination ("collusion") can't be fully prevented — don't be that table. Violations may lead to removal. Correlation alone is never treated as proof.</p>
      </div>
      <div className={S}><div className={H}>3 · YOUR CONTENT</div>
        <p className="font-medium">Questions, names, and chat must be lawful and non-abusive. You grant us a license to display your content in matches. Hate, harassment, sexual content involving minors, and illegal content are banned and may be blocklisted. Report abuse with the in-game report button.</p>
      </div>
      <div className={S}><div className={H}>4 · ACCOUNTS</div>
        <p className="font-medium">You are responsible for your account. One account per human for stats integrity. We may revoke sessions or close abusive accounts.</p>
      </div>
      <div className={S}><div className={H}>5 · AVAILABILITY</div>
        <p className="font-medium">Free-tier hosting: no uptime promises. Matches may be cancelled on restart (stakes refunded). We may change or shut down the service.</p>
      </div>
      <div className={S}><div className={H}>6 · LIABILITY</div>
        <p className="font-medium">Provided "as is", no warranties. To the extent the law allows, we are not liable for lost matches, stats, or hurt feelings from being outvoted.</p>
      </div>
      <button onClick={onBack} className="mt-4 w-full border-4 border-black bg-[#0A0A0A] p-3 font-display text-sm text-white">← BACK</button>
    </div>
  );
}
