/**
 * B14 · The simulated radiologists (fast / slow / silent). They live on the
 * organization document (`organizations/{org}.radiologists`); there are no
 * sign-in accounts behind them, and they are named "(simulated)" everywhere.
 * Pure: no Firebase.
 */
import type { ReadProfile } from "./gate";

export interface Radiologist {
  id: string;
  name: string;
  profile: ReadProfile;
  simulated: true;
}

export const DEFAULT_ROSTER: Radiologist[] = [
  { id: "sim-fast", name: "Dr. N. Okafor", profile: "fast", simulated: true },
  { id: "sim-slow", name: "Dr. T. Bello", profile: "slow", simulated: true },
  { id: "sim-silent", name: "Dr. H. Danjuma", profile: "silent", simulated: true },
];

/** How long each profile takes to sign; a silent reader's ETA is when it is nudged. */
export const READ_MS: Record<ReadProfile, number> = { fast: 2 * 60_000, slow: 6 * 60_000, silent: 4 * 60_000 };
/** After a nudge, how long a silent reader has before the read moves to the fast reader. */
export const NUDGE_GRACE_MS = 2 * 60_000;

export const READ_NOTE: Record<ReadProfile, string> = {
  fast: "Agree with the draft findings.",
  slow: "Agree with the draft findings; no further observations.",
  silent: "Agree with the draft findings.",
};

/** A valid roster from an organization document, or the default one. */
export function rosterOf(org: { radiologists?: unknown } | undefined): Radiologist[] {
  const list = Array.isArray(org?.radiologists) ? (org.radiologists as Partial<Radiologist>[]) : [];
  const ok = list.filter((r): r is Radiologist => !!r && typeof r.id === "string" && typeof r.name === "string" && (r.profile === "fast" || r.profile === "slow" || r.profile === "silent"));
  return ok.length ? ok.map((r) => ({ ...r, simulated: true })) : DEFAULT_ROSTER;
}

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Critical cases go to the fast reader; the rest rotate by study id, so all three readers appear. */
export function pickReader(roster: Radiologist[], study: { id: string; priority?: string | null }): Radiologist {
  const fast = roster.find((r) => r.profile === "fast");
  if (study.priority === "critical" && fast) return fast;
  return roster[stableHash(study.id) % roster.length];
}

export function fastReader(roster: Radiologist[]): Radiologist {
  return roster.find((r) => r.profile === "fast") ?? DEFAULT_ROSTER[0];
}

/** "Dr. N. Okafor (simulated)". */
export const readerLabel = (name: string): string => `${name} (simulated)`;
