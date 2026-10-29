/**
 * §4.11 · What each source allows besides review: an upload can be deleted by
 * the clinician who uploaded it (until it is signed: signed studies are kept
 * for the audit trail); a sample can be reset by any member of the workspace,
 * back to a fresh draft, and never deleted.
 */
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { asCaller, callerOf, canAct, isSample, type Caller } from "../lib/access";
import { studyDirOf } from "../lib/storagePaths";
import type { StudyStatus } from "../study/stateMachine";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

const SIGNED: readonly StudyStatus[] = ["signed", "patient_summary_ready", "shared", "closed"];
/** A sample can be reset once its draft exists. */
const RESETTABLE: readonly StudyStatus[] = ["ready", "clinician_review", ...SIGNED];
/** Step stamps written after the draft; a reset removes them. */
const AFTER_DRAFT_STEPS = ["clinician_review", "signed", "patient_summary_ready", "shared", "closed"];

interface LifecycleStudy {
  orgId?: string;
  clinicianUid?: string;
  source?: string;
  status?: StudyStatus;
  image?: { storagePath?: string | null } | null;
  findings?: Record<string, unknown>[];
  clinicianSummary?: { editedByClinician?: boolean } | null;
  priority?: string | null;
  coordinator?: { plannedAt?: unknown; fromPriority?: string | null } | null;
}

async function load(db: Firestore, studyId: unknown) {
  if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");
  const ref = db.collection("studies").doc(studyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
  return { ref, study: snap.data() as LifecycleStudy };
}

/** Deletes an unsigned upload: the image, findings, report, note, shares and trace. */
export async function deleteUploadCore(deps: { db: Firestore; bucket: Bucket }, caller: Caller, req: { studyId?: unknown }): Promise<{ deleted: true }> {
  const { uid } = asCaller(caller);
  const { ref, study } = await load(deps.db, req.studyId);
  if (study.source !== "upload" || study.clinicianUid !== uid) throw new HttpsError("permission-denied", "Only the clinician who uploaded this study can delete it.");
  if (study.status && SIGNED.includes(study.status)) throw new HttpsError("failed-precondition", "Signed studies are kept for the audit trail.");
  const dir = studyDirOf(ref.id, study);
  await deps.bucket.deleteFiles({ prefix: `${dir}/` }).catch(() => undefined);
  // Subcollections (trace, audit) go with it; the case id stays reserved.
  await deps.db.recursiveDelete(ref);
  logger.info("deleteUpload: deleted", { studyId: ref.id });
  return { deleted: true };
}

/** Returns a sample to its fresh draft: decisions, signature, note, shares and the coordinator's marks cleared. */
export async function resetSampleCore(db: Firestore, caller: Caller, req: { studyId?: unknown }): Promise<{ reset: true }> {
  const { uid, orgId } = asCaller(caller);
  const { ref } = await load(db, req.studyId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const study = snap.data() as LifecycleStudy;
    if (!isSample(study) || !canAct(study, uid, orgId)) throw new HttpsError("permission-denied", "Only sample studies can be reset.");
    if (!study.status || !RESETTABLE.includes(study.status)) throw new HttpsError("failed-precondition", "The sample is still being analyzed.");
    const findings = (study.findings ?? []).map((f) => {
      const { editedText: _edited, ...rest } = f as { editedText?: string };
      return { ...rest, status: "pending", reviewedAt: null };
    });
    tx.update(ref, {
      status: "ready",
      findings,
      reviewHash: null,
      // A drafted report the clinician never edited still matches the draft.
      clinicianSummary: study.clinicianSummary?.editedByClinician ? null : (study.clinicianSummary ?? null),
      reportDraft: FieldValue.delete(),
      report: FieldValue.delete(),
      signed: FieldValue.delete(),
      patientSummary: null,
      shares: [],
      deletedAt: null,
      "demo.autopilot": FieldValue.delete(),
      // B13: the coordinator's plan, escalation and any lane it raised.
      coordinator: FieldValue.delete(),
      "flags.needsHuman": false,
      ...(study.coordinator?.plannedAt ? { priority: study.coordinator.fromPriority ?? study.priority ?? null } : {}),
      ...Object.fromEntries(AFTER_DRAFT_STEPS.map((s) => [`pipeline.stepTimestamps.${s}`, FieldValue.delete()])),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(ref.collection("audit").doc(), { at: FieldValue.serverTimestamp(), actor: uid, action: "sample_reset", from: study.status, to: "ready" });
    tx.create(ref.collection("trace").doc(), {
      at: Timestamp.now(),
      seq: Date.now(),
      stage: "reset",
      kind: "check",
      name: "reset_sample",
      ok: true,
      result: "Reset by a clinician · decisions, signature, note and shares cleared",
    });
  });
  logger.info("resetSample: reset", { studyId: ref.id });
  return { reset: true };
}

export const deleteUpload = onCall<{ studyId: string }, Promise<{ deleted: true }>>({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return deleteUploadCore({ db: getFirestore(), bucket: getStorage().bucket() }, callerOf(request.auth), request.data ?? {});
});

export const resetSample = onCall<{ studyId: string }, Promise<{ reset: true }>>({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return resetSampleCore(getFirestore(), callerOf(request.auth), request.data ?? {});
});
