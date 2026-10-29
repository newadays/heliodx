import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { wrongState } from "../lib/callableErrors";
import { runPipeline, type StudyForPipeline } from "../pipeline/run";
import { RUNNING_STATUSES, WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import { callerOf, canAct } from "../lib/access";

/** An in-flight study whose last step is older than this may be re-run. */
export const STALE_AFTER_MS = 4 * 60 * 1000;

/** Pure: may this study be re-run now? */
export function canRetry(
  status: string,
  lastStepAtMs: number | null,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: "not_uploaded" | "in_progress" | "already_ready" } {
  if (status === "uploading") return { ok: false, reason: "not_uploaded" };
  if (status === "failed" || status === "queued") return { ok: true };
  if (!RUNNING_STATUSES.includes(status as StudyStatus)) return { ok: false, reason: "already_ready" };
  if (lastStepAtMs !== null && nowMs - lastStepAtMs >= STALE_AFTER_MS) return { ok: true };
  return { ok: false, reason: "in_progress" };
}

/**
 * Re-runs the pipeline on the stored image for a failed study, or for one
 * that has gone quiet for STALE_AFTER_MS. Runs synchronously within the
 * callable so the client sees status updates on its existing listener.
 */
export const retryPipeline = onCall<{ studyId: string; analyzeAnyway?: boolean }, Promise<{ started: boolean }>>(
  { enforceAppCheck: false, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const studyId = request.data?.studyId;
    if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");

    const ref = getFirestore().collection("studies").doc(studyId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
    const caller = callerOf(request.auth);
    if (!canAct(snap.data() ?? {}, caller.uid, caller.orgId)) throw new HttpsError("permission-denied", "Not your study.");

    const study = snap.data() as StudyForPipeline & { pipeline?: { stepTimestamps?: Record<string, { toMillis(): number }>; error?: { code?: string } | null } };
    // "Analyze anyway": only after a quality rejection, and recorded as the clinician's decision.
    const analyzeAnyway = request.data?.analyzeAnyway === true;
    if (analyzeAnyway && !(study.status === "failed" && study.pipeline?.error?.code === "quality_rejected")) {
      throw new HttpsError("failed-precondition", "Only a study stopped by the image quality check can be analyzed anyway.");
    }
    const override = analyzeAnyway ? { by: request.auth.uid, at: new Date() } : null;
    const stamps = Object.values(study.pipeline?.stepTimestamps ?? {}).map((t) => t.toMillis());
    const lastStepAt = stamps.length ? Math.max(...stamps) : null;
    const decision = canRetry(study.status, lastStepAt);
    if (!decision.ok) {
      const msg =
        decision.reason === "not_uploaded"
          ? "The image has not finished uploading."
          : decision.reason === "already_ready"
            ? "This study is already analyzed."
            : "Analysis is still running. Give it a moment.";
      throw new HttpsError("failed-precondition", msg);
    }

    const eventId = `retry-${Date.now()}`;
    logger.info("retryPipeline: starting", { studyId, from: study.status });
    // Back to the queue so the status walk and the app's stepper restart
    // cleanly. A stale run still in flight loses ownership when the new run
    // claims the study, so its late writes are refused.
    if (study.status !== "queued") {
      try {
        await new StudyWriter(ref, { uid: request.auth.uid }).requeue({
          action: analyzeAnyway ? "analyze_anyway" : "retry_requested",
          resetAttempts: true,
          ...(override ? { fields: { "pipeline.qualityOverride": override } } : {}),
        });
      } catch (error) {
        if (error instanceof WrongStateError) throw wrongState(error, "This study can't be retried right now.");
        throw error;
      }
    }
    const pipeline = override ? { ...study.pipeline, qualityOverride: override } : study.pipeline;
    await runPipeline(ref, { ...study, status: "queued", pipeline }, eventId, { bucket: getStorage().bucket().name });
    return { started: true };
  },
);
