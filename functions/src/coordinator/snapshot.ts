/**
 * B13 · The de-identified queue the coordinator (Muse Wonder) sees: study
 * ids, stages, priorities, ages, SLA and flags. Never images, clinical text
 * or identifiers; every key is in `COORDINATION_KEYS`
 * (models/routes.ts), which `assertPayloadAllowed` enforces before sending.
 */
import { slaBudgetMs } from "../lib/sla";

export type Lane = "routine" | "urgent" | "critical";

export interface QueueItem {
  studyId: string;
  stage: string;
  priority: Lane | null;
  ageMinutes: number;
  /** Minutes left on the reading SLA (negative = overdue); null when none applies. */
  slaMinutesLeft: number | null;
  flags: { needsRetake: boolean; degraded: boolean; needsHuman: boolean };
  /**
   * What was last decided or happened, as a code: "planned", "escalated",
   * "requeued", "failed:<error code>", "failed:exhausted" (already requeued
   * once), "stalled", or "none".
   */
  lastAction: string;
}

/** The fields of a study document the snapshot reads (Firestore shape). */
export interface CoordinatorStudy {
  id: string;
  status: string;
  priority?: string | null;
  createdAt?: { toMillis(): number } | null;
  updatedAt?: { toMillis(): number } | null;
  deletedAt?: unknown;
  flags?: { needsRetake?: boolean; degraded?: boolean; needsHuman?: boolean } | null;
  pipeline?: { stepTimestamps?: Record<string, { toMillis(): number } | undefined>; error?: { code?: string } | null } | null;
  coordinator?: { plannedAt?: unknown; requeues?: number; escalation?: unknown } | null;
}

/** Studies the coordinator watches: not yet signed and not deleted. */
export const WATCHED_STATUSES = ["queued", "quality_check", "classifying", "detecting", "summarizing", "ready", "clinician_review", "failed"] as const;
export const RUNNING = new Set(["queued", "quality_check", "classifying", "detecting", "summarizing"]);
/** A running study with no progress for this long is stalled. */
export const STALLED_MS = 20 * 60_000;
export const QUEUE_LIMIT = 40;

const LANES: Lane[] = ["routine", "urgent", "critical"];
const asLane = (p: unknown): Lane | null => (LANES.includes(p as Lane) ? (p as Lane) : null);
const ms = (t: { toMillis(): number } | null | undefined) => (t ? t.toMillis() : 0);

function lastAction(s: CoordinatorStudy, now: number): string {
  if (s.coordinator?.escalation) return "escalated";
  // A failure the coordinator already requeued once is exhausted: escalate, never requeue again.
  if (s.status === "failed") return s.coordinator?.requeues ? "failed:exhausted" : `failed:${s.pipeline?.error?.code ?? "unknown"}`;
  if (RUNNING.has(s.status) && ms(s.updatedAt) && now - ms(s.updatedAt) > STALLED_MS) return "stalled";
  if (s.coordinator?.requeues) return "requeued";
  if (s.coordinator?.plannedAt) return "planned";
  return "none";
}

export function queueItem(s: CoordinatorStudy, now: number): QueueItem {
  const priority = asLane(s.priority);
  const start = ms(s.pipeline?.stepTimestamps?.detecting) || ms(s.createdAt);
  const budget = slaBudgetMs(priority);
  return {
    studyId: s.id,
    stage: s.status,
    priority,
    ageMinutes: Math.max(0, Math.round((now - ms(s.createdAt)) / 60_000)),
    slaMinutesLeft: budget !== null && start ? Math.round((start + budget - now) / 60_000) : null,
    flags: { needsRetake: !!s.flags?.needsRetake, degraded: !!s.flags?.degraded, needsHuman: !!s.flags?.needsHuman },
    lastAction: lastAction(s, now),
  };
}

export function queueSnapshot(studies: CoordinatorStudy[], now: number): { queue: QueueItem[] } {
  return { queue: studies.filter((s) => !s.deletedAt).slice(0, QUEUE_LIMIT).map((s) => queueItem(s, now)) };
}

/** Whether anything in the queue needs a decision (otherwise Wonder is not called). */
export function needsDecision(item: QueueItem): boolean {
  if (item.lastAction === "escalated") return false;
  if ((item.stage === "ready" || item.stage === "clinician_review") && item.lastAction === "none") return true;
  if (item.lastAction.startsWith("failed:") || item.lastAction === "stalled") return true;
  if (item.flags.needsRetake) return true;
  return item.slaMinutesLeft !== null && item.slaMinutesLeft < 0;
}
