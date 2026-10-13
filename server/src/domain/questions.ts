/** Normalize for duplicate detection; display text is preserved separately. */
export function normalizeQuestion(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface QuestionCheck {
  ok: boolean;
  reason?: string;
}

const YES_NO_HINT = /(yes|no|نعم|لا|\?|？)/i;

/** Structural validation. Moderation (reporting/review) lives server-side. */
export function checkQuestion(text: unknown, maxLength: number): QuestionCheck {
  if (typeof text !== "string") return { ok: false, reason: "invalid-payload" };
  const t = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (t.length === 0) return { ok: false, reason: "empty" };
  if (t.length > maxLength) return { ok: false, reason: "too-long" };
  if (!YES_NO_HINT.test(t) && t.length < 12) return { ok: false, reason: "not-yes-no" };
  return { ok: true };
}

/** Neutral fallback questions (pre-approved, no hidden-match dependency). */
export const FALLBACK_QUESTIONS = [
  "Should the table always target the current chip leader? (YES/NO)",
  "Is bluffing an acceptable strategy in this game? (YES/NO)",
  "Should ties punish everyone instead of refunding? (YES/NO)",
  "Is silence more suspicious than talking? (YES/NO)",
];

/** Curated, localized bot question bank (no runtime AI dependency). */
export const BOT_QUESTION_BANK: { category: string; text: string }[] = [
  { category: "ethics", text: "Is lying to win this game acceptable? (YES/NO)" },
  { category: "ethics", text: "Should winners share with losers out of pity? (YES/NO)" },
  { category: "ethics", text: "Would you betray an ally here for double the pot? (YES/NO)" },
  { category: "trust", text: "Should the chip leader reveal their vote first? (YES/NO)" },
  { category: "trust", text: "Is anyone who talks too much hiding something? (YES/NO)" },
  { category: "trust", text: "Should the poorest player get immunity this round? (YES/NO)" },
  { category: "risk", text: "Is it smart to always vote against the crowd? (YES/NO)" },
  { category: "risk", text: "Should the final pot go to ONE winner? (YES/NO)" },
  { category: "social", text: "Is teamwork just a trap for the naive? (YES/NO)" },
  { category: "social", text: "Should the whole table target the leader? (YES/NO)" },
  { category: "behavior", text: "Is silence more suspicious than bluffing? (YES/NO)" },
  { category: "behavior", text: "Do most players lie about their vote? (YES/NO)" },
  { category: "humor", text: "Is this table full of cowards? (YES/NO)" },
  { category: "humor", text: "Should the loudest player pay double stakes? (YES/NO)" },
  { category: "ethics-ar", text: "هل الكذب للفوز في هذه اللعبة مقبول؟ (نعم/لا)" },
  { category: "trust-ar", text: "هل يجب أن يكشف المتصدر صوته أولاً؟ (نعم/لا)" },
];

/** Escape for HTML contexts — server stores raw text, clients must escape. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
