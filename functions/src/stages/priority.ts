/** Pure priority rules for triage (B11): recall first. */
import type { MeasurementFlag } from "../tools/measure";

export type Priority = "routine" | "urgent" | "critical";
const RANK: Record<Priority, number> = { routine: 0, urgent: 1, critical: 2 };

export function maxPriority(...ps: Priority[]): Priority {
  return ps.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "routine" as Priority);
}

/** The minimum priority the thresholds demand; the model may raise it, never lower it. */
export function priorityFloor(flags: MeasurementFlag[]): Priority {
  if (flags.some((f) => f.level === "critical")) return "critical";
  if (flags.some((f) => f.level === "urgent")) return "urgent";
  return "routine";
}

/** Keep only evidence ids that name a real measurement or mask. */
export function validEvidence(evidence: string[], allowed: Iterable<string>): string[] {
  const ok = new Set(allowed);
  return [...new Set(evidence.map((e) => e.trim()))].filter((e) => ok.has(e));
}
