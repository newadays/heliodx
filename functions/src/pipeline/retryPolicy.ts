/**
 * Which pipeline failures are worth another automatic attempt. Pure.
 *
 * Transient: the private model service was down, cold or too slow. The study
 * goes back to the queue and the sweeper (`scheduled/requeueStudies.ts`)
 * runs it again. Everything else is a real outcome (bad image, refusal,
 * invalid output, bug) and fails the study for the clinician to act on.
 */
import type { PipelineErrorCode } from "./errors";

export const TRANSIENT_CODES: readonly PipelineErrorCode[] = ["model_unavailable", "timeout"];

/** Automatic attempts per study before it is failed; a manual retry resets the count. */
export const MAX_ATTEMPTS = 3;

export function isTransient(code: PipelineErrorCode): boolean {
  return TRANSIENT_CODES.includes(code);
}

/** After this failure, given how many transient failures came before it. */
export function nextStep(
  code: PipelineErrorCode,
  previousAttempts: number,
  opts: { countAttempt?: boolean } = {},
): "requeue" | "fail" {
  if (!isTransient(code)) return "fail";
  // Waiting for a cold GPU is not a failed attempt (see isWarmingWait).
  if (opts.countAttempt === false) return "requeue";
  return previousAttempts + 1 < MAX_ATTEMPTS ? "requeue" : "fail";
}

/**
 * The private GPU scales to zero and takes ~5-6 minutes to start. A study
 * that arrives meanwhile waits in the queue without using up attempts, for
 * at most this long after it was created; after that, waits count.
 */
export const MAX_WARMING_WAIT_MS = 20 * 60 * 1000;

export function isWarmingWait(createdAtMs: number | null, nowMs: number): boolean {
  return createdAtMs !== null && nowMs - createdAtMs < MAX_WARMING_WAIT_MS;
}
