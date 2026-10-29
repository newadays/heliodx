/**
 * B14 · When a radiologist must read a case before the clinician signs.
 * The rule is code, not a prompt: the coordinator's `radiologistReadSuggested`
 * is shown as a hint only. Pure (no Firebase): the web app imports it to show
 * the same reason the server enforces.
 */
export type ReadReason = "critical" | "weak_finding" | "requested" | "needs_human";
export type ReadProfile = "fast" | "slow" | "silent";

export interface RadiologistRead {
  required: true;
  reason: ReadReason;
  status: "assigned" | "signed";
  assignee: string;
  assigneeName: string;
  profile: ReadProfile;
  simulated: true;
  assignedAt: unknown;
  eta: unknown;
  nudgedAt?: unknown;
  /** The reader it was taken from after a silent spell. */
  reassignedFrom?: string;
  requestedBy?: string;
  signedAt?: unknown;
  note?: string;
}

export interface GateStudy {
  priority?: string | null;
  flags?: { needsHuman?: boolean } | null;
  findings?: { status?: string; strength?: string }[];
  radiologistRead?: { requestedBy?: string; status?: string; required?: boolean } | null;
}

/** Why a read is required, or null. The first reason that applies, in this order. */
export function readRequirement(study: GateStudy): { reason: ReadReason } | null {
  if (study.priority === "critical") return { reason: "critical" };
  if (study.flags?.needsHuman) return { reason: "needs_human" };
  if ((study.findings ?? []).some((f) => (f.status === "accepted" || f.status === "edited") && f.strength === "weak")) return { reason: "weak_finding" };
  if (study.radiologistRead?.requestedBy) return { reason: "requested" };
  return null;
}

/** The reasons the coordinator tick opens a read for on its own; the others wait for the clinician. */
export const AUTO_REASONS: ReadonlySet<ReadReason> = new Set(["critical", "needs_human"]);

/** "request" when a read is required and none exists, "close" while one is open, null otherwise. */
export function readNeed(study: GateStudy): "request" | "close" | null {
  const read = study.radiologistRead;
  if (read?.status === "signed") return null;
  if (read?.status) return "close";
  return readRequirement(study) ? "request" : null;
}

export const READ_REASON_TEXT: Record<ReadReason, string> = {
  critical: "critical priority",
  weak_finding: "an accepted finding has weak evidence",
  requested: "requested by the clinician",
  needs_human: "flagged for a human",
};
