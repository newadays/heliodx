/**
 * B14 · The clinician asks for a radiologist read. The read goes to a
 * simulated radiologist from the organization's roster; the coordinator
 * tick moves it along. Allowed for the study's owner (or a sample's
 * workspace member) while the draft is ready or in review, once.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { asCaller, callerOf, canAct, type Caller } from "../lib/access";
import { assignRead, READ_STATUSES } from "../radiology/reads";
import type { StudyStatus } from "../study/stateMachine";

export async function requestRadiologistReadCore(db: Firestore, caller: Caller, req: { studyId?: unknown }, now = Date.now()): Promise<{ assigned: true }> {
  if (typeof req.studyId !== "string" || !req.studyId) throw new HttpsError("invalid-argument", "studyId is required.");
  const { uid, orgId } = asCaller(caller);
  const ref = db.collection("studies").doc(req.studyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
  const study = snap.data() ?? {};
  if (!canAct(study, uid, orgId)) throw new HttpsError("permission-denied", "Only the clinician who owns this study can request a read.");
  if (!READ_STATUSES.includes(study.status as StudyStatus)) throw new HttpsError("failed-precondition", "A read can be requested once the draft is ready and before signing.");
  if (study.radiologistRead?.status) throw new HttpsError("already-exists", "A radiologist read is already open for this study.");
  if (!(await assignRead(db, ref, { actor: { uid }, now, requestedBy: uid }))) {
    throw new HttpsError("failed-precondition", "The read could not be assigned; reload and try again.");
  }
  logger.info("requestRadiologistRead: assigned", { studyId: ref.id });
  return { assigned: true };
}

export const requestRadiologistRead = onCall<{ studyId: string }, Promise<{ assigned: true }>>({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return requestRadiologistReadCore(getFirestore(), callerOf(request.auth), request.data ?? {});
});
