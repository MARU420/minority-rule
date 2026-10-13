import { z } from "zod";

export const MatchSettingsSchema = z.object({
  minParticipants: z.number().int().min(2).max(12).default(3),
  maxParticipants: z.number().int().min(2).max(24).default(12),
  targetParticipants: z.number().int().min(2).max(24).default(6),
  startingBalance: z.number().int().min(0).max(100000).default(100),
  stake: z.number().int().min(1).max(10000).default(10),
  votingDurationSec: z.number().int().min(5).max(300).default(30),
  submissionDurationSec: z.number().int().min(10).max(900).default(120),
  roundIntroSec: z.number().int().min(0).max(60).default(5),
  /** fill empty seats with bots up to target at match start */
  botFill: z.boolean().default(true),
  /** show who authored each question */
  revealAuthorship: z.boolean().default(true),
  /** 'refund' (default) — ties refund all stakes */
  tiePolicy: z.enum(["refund"]).default("refund"),
  /** missing vote policy: abstain (stake forfeited, no vote counted) */
  missingVotePolicy: z.enum(["abstain"]).default("abstain"),
  /** missing question policy: server assigns neutral fallback */
  missingQuestionPolicy: z.enum(["fallback"]).default("fallback"),
  /** temporarily bot-control disconnected seats */
  botTakeover: z.boolean().default(true),
  botTakeoverGraceSec: z.number().int().min(0).max(600).default(30),
  reconnectGraceSec: z.number().int().min(0).max(3600).default(300),
  /** allow changing a submitted vote until deadline */
  allowVoteChange: z.boolean().default(true),
  maxQuestionLength: z.number().int().min(20).max(500).default(200),
}).refine((s) => s.minParticipants <= s.targetParticipants && s.targetParticipants <= s.maxParticipants, {
  message: "require min <= target <= max participants",
});

export type MatchSettings = z.infer<typeof MatchSettingsSchema>;

export const DEFAULT_SETTINGS: MatchSettings = MatchSettingsSchema.parse({});

export function validateSettings(input: unknown): MatchSettings {
  return MatchSettingsSchema.parse(input);
}
