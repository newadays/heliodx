/**
 * Wakes the private model service when a clinician signs in, so the first
 * study does not wait for a cold GPU. The service scales to zero (no warm
 * instance is kept); one ping starts an instance, which then stays up while
 * it is used and for Cloud Run's idle period after.
 *
 * Throttled to one ping per WARM_INTERVAL_MS across all users, so a busy
 * clinic does not ping on every sign-in. Sends no patient data.
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { gpuHealth } from "../models/gpu";

// Below the web's 4-minute heartbeat (StudyPage), so each heartbeat gets
// through and the GPU never reaches Cloud Run's ~8-minute idle shutdown.
export const WARM_INTERVAL_MS = 3 * 60 * 1000;

/** Pure: should this sign-in ping the GPU? */
export function shouldWarm(lastWarmMs: number | null, nowMs: number): boolean {
  return lastWarmMs === null || nowMs - lastWarmMs >= WARM_INTERVAL_MS;
}

export const warmModels = onCall({ enforceAppCheck: false, timeoutSeconds: 30 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!(request.auth.token as { orgId?: string }).orgId) {
    throw new HttpsError("permission-denied", "Join an organization first.");
  }

  const ref = getFirestore().collection("system").doc("modelWarmup");
  const now = Date.now();
  const claimed = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = snap.exists ? Number(snap.get("lastRequestedAtMs") ?? 0) || null : null;
    if (!shouldWarm(last, now)) return false;
    tx.set(ref, { lastRequestedAtMs: now }, { merge: true });
    return true;
  });
  if (!claimed) return { started: false, reason: "recently_warmed" as const };

  // A request is what makes Cloud Run start an instance; it keeps starting
  // after this call stops waiting. While loading, /health answers 503.
  const health = await gpuHealth();
  logger.info("warmModels: pinged", { glimmer: health.glimmer, sam: health.sam });
  return { started: true, glimmer: health.glimmer, sam: health.sam };
});
