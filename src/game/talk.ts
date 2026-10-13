import type { Player, Vote } from "./engine";

export interface Question {
  id: "which-side" | "team-yes" | "team-no" | "lying" | "distrust";
  label: string;
}

export const QUESTIONS: Question[] = [
  { id: "which-side", label: "Which side are you voting?" },
  { id: "team-yes", label: "Vote YES with me?" },
  { id: "team-no", label: "Vote NO with me?" },
  { id: "lying", label: "Are you lying to me?" },
  { id: "distrust", label: "Who should I NOT trust?" },
];

function personality(id: number): "random" | "follower" | "contrarian" {
  if (id % 3 === 0) return "random";
  if (id % 3 === 1) return "follower";
  return "contrarian";
}

function lieChance(id: number): number {
  const p = personality(id);
  if (p === "contrarian") return 0.6;
  if (p === "random") return 0.4;
  return 0.3;
}

const lies = (truth: Vote) => (truth === "YES" ? "NO" : "YES");

export function botReply(
  bot: Player,
  q: Question["id"],
  intended: Vote,
  players: Player[],
): string {
  const lie = Math.random() < lieChance(bot.id);
  const claimed = lie ? lies(intended) : intended;
  switch (q) {
    case "which-side":
      return `I'm voting ${claimed}. ${lie ? "Trust me." : "That's the truth."}`;
    case "team-yes":
      if (intended === "YES") return "Deal. YES together, we take the pot.";
      return lie ? "Sure, YES with you. (hmm)" : "No — YES is crowded. I'm on NO.";
    case "team-no":
      if (intended === "NO") return "Deal. NO together, we take the pot.";
      return lie ? "Sure, NO with you. (hmm)" : "No — NO is crowded. I'm on YES.";
    case "lying":
      return lie ? "Me? Lying? Never. Believe me." : `Honest — I'm really on ${intended}.`;
    case "distrust": {
      const others = players.filter((p) => p.id !== bot.id && !p.isYou);
      const pick = others[Math.floor(Math.random() * others.length)];
      return pick ? `Watch ${pick.name}. ${pick.name} is herding votes.` : "Trust no one. Not even me.";
    }
  }
}

export function ambientLine(_bot: Player, intended: Vote): string {
  const lines = [
    `I'm on ${intended}. Come with me if you want to win.`,
    `${intended} is the minority. The math is obvious.`,
    `Too many sheep on ${intended === "YES" ? "NO" : "YES"}. Free money.`,
    `Someone here is running a coalition. Don't be the mark.`,
    `I've already decided: ${intended}. No changing.`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
