/**
 * The study lifecycle as data. Pure: no Firebase, unit-tested.
 *
 * `status` keeps the pipeline values the app's stepper already understands
 * (uploading → queued → quality_check → classifying → detecting →
 * summarizing → ready | failed). The case stages after `ready` are defined
 * here so later cards (sign, patient summary, share) only add writes, not
 * new rules:
 *
 *   ready → clinician_review → signed → patient_summary_ready → shared → closed
 *
 * Flags sit beside the status and never block a transition on their own.
 */

export const STUDY_STATUSES = [
  "uploading",
  "queued",
  "quality_check",
  "classifying",
  "detecting",
  "summarizing",
  "ready",
  "failed",
  "clinician_review",
  "signed",
  "patient_summary_ready",
  "shared",
  "closed",
] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

export interface StudyFlags {
  needsRetake: boolean;
  degraded: boolean;
  needsHuman: boolean;
}

/** Statuses a pipeline run is actively working in. */
export const RUNNING_STATUSES: readonly StudyStatus[] = ["quality_check", "classifying", "detecting", "summarizing"];

/**
 * Legal moves. A running step may always be requeued (model service down)
 * or failed; a failed study may only go back to the queue (retry).
 */
const TRANSITIONS: Record<StudyStatus, readonly StudyStatus[]> = {
  uploading: ["queued", "quality_check", "failed"],
  queued: ["queued", "quality_check", "failed"],
  quality_check: ["classifying", "queued", "failed"],
  classifying: ["detecting", "queued", "failed"],
  detecting: ["summarizing", "queued", "failed"],
  summarizing: ["ready", "queued", "failed"],
  failed: ["queued"],
  ready: ["clinician_review", "signed", "closed"],
  clinician_review: ["signed", "closed"],
  signed: ["patient_summary_ready", "closed"],
  patient_summary_ready: ["shared", "closed"],
  shared: ["shared", "closed"],
  closed: [],
};

export function canTransition(from: StudyStatus, to: StudyStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses from which `to` can be reached; what the caller "needs" first. */
export function predecessorsOf(to: StudyStatus): StudyStatus[] {
  return STUDY_STATUSES.filter((s) => TRANSITIONS[s].includes(to));
}

/**
 * A write that the study's current state does not allow. `needs` lists what
 * would have to be true first, so a callable can return it to the app.
 */
export class WrongStateError extends Error {
  constructor(
    readonly stage: StudyStatus | "missing",
    readonly needs: string[],
    message = `Study is ${stage}; needs ${needs.join(" or ") || "nothing"}.`,
  ) {
    super(message);
    this.name = "WrongStateError";
  }
}

export function assertTransition(from: StudyStatus, to: StudyStatus): void {
  if (!canTransition(from, to)) {
    throw new WrongStateError(from, predecessorsOf(to).map((s) => `status ${s}`));
  }
}

export function isStudyStatus(value: unknown): value is StudyStatus {
  return typeof value === "string" && (STUDY_STATUSES as readonly string[]).includes(value);
}
