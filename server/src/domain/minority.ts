export type Vote = "YES" | "NO";

export interface MinorityOutcome {
  yes: number;
  no: number;
  /** null = tie, no minority */
  minority: Vote | null;
}

/** Pure minority detection over authoritative valid votes. */
export function detectMinority(votes: Vote[]): MinorityOutcome {
  let yes = 0;
  let no = 0;
  for (const v of votes) {
    if (v === "YES") yes++;
    else no++;
  }
  if (yes === no) return { yes, no, minority: null };
  return { yes, no, minority: yes < no ? "YES" : "NO" };
}
