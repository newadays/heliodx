/**
 * B15 · Sign a study. Only the clinician who owns it may sign. Everything is
 * checked and written in one transaction: the sign rules (lib/report.ts),
 * the frozen report and its SHA-256 hash, the signer, the status move to
 * `signed`, and an audit entry. A signed study is read-only to the app
 * (Firestore rules allow client edits only while `ready`).
 */
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { wrongState } from "../lib/callableErrors";
import { freezeReport, reportHash, signNeeds, type SignNeed, type SignableStudy } from "../lib/report";
import { reviewHash } from "../lib/reviewHash";
import { WrongStateError } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import { traceEvent, traceScope } from "../lib/trace";
import { asCaller, callerOf, canAct, type Caller } from "../lib/access";

export interface SignRequest {
  studyId: string;
  /** The clinician confirms the drafted impression and recommendation as their own. */
  confirmImpression?: boolean;
  /** The signing browser, as "web / <user agent>" (first 100 characters). */
  device?: string;
}

export interface SignResult {
  reportHash: string;
  signedAt: string;
}

/** Thrown when the sign rules are not met; carries what is missing. */
export class NotReadyToSign extends Error {
  constructor(readonly needs: SignNeed[]) {
    super(`Not ready to sign: ${needs.join(", ")}`);
    this.name = "NotReadyToSign";
  }
}

export async function signStudyCore(
  db: Firestore,
  caller: Caller,
  req: SignRequest,
  now: Date = new Date(),
): Promise<SignResult> {
  const ref = db.collection("studies").doc(req.studyId);
  const first = await ref.get();
  if (!first.exists) throw new HttpsError("not-found", "Study not found.");
  const { uid, orgId } = asCaller(caller);
  if (!canAct(first.data() ?? {}, uid, orgId)) throw new HttpsError("permission-denied", "Only the clinician who owns this study can sign it.");

  const device = typeof req.device === "string" ? req.device.slice(0, 120) : null;
  let hash = "";
  await new StudyWriter(ref, { uid }).advanceWith(
    "signed",
    (data) => {
      const study = data as SignableStudy & { clinicianName?: string };
      const needs = signNeeds(study, { confirmImpression: req.confirmImpression === true });
      if (needs.length) throw new NotReadyToSign(needs);
      const report = freezeReport(req.studyId, study, uid, now);
      hash = reportHash(report);
      return {
        report,
        signed: {
          by: uid,
          name: study.clinicianName ?? "",
          at: Timestamp.fromDate(now),
          device,
          reportHash: hash,
          reviewHash: reviewHash(study.findings ?? []),
          impressionConfirmed: !study.clinicianSummary?.editedByClinician,
        },
      };
    },
    { action: "study_signed" },
  );
  await traceScope(ref, "signed", async () => {
    traceEvent({ kind: "check", name: "freeze_report", args: { confirmImpression: req.confirmImpression === true }, ok: true, result: `report frozen · ${hash.slice(0, 15)}…` });
  });
  return { reportHash: hash, signedAt: now.toISOString() };
}

const NEED_TEXT: Record<SignNeed, string> = {
  decide_every_finding: "Accept, edit or reject every finding.",
  request_radiologist_read: "Request a radiologist read.",
  close_radiologist_read: "Wait for the radiologist's read.",
  write_impression: "Write the impression.",
  write_recommendation: "Write the recommendation.",
  refresh_summary: "Regenerate the summary from your review, or edit it.",
  confirm_impression: "Confirm the impression and recommendation as your own.",
};

export const signStudy = onCall<SignRequest, Promise<SignResult>>({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const studyId = request.data?.studyId;
  if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");
  try {
    const out = await signStudyCore(getFirestore(), callerOf(request.auth), request.data);
    logger.info("signStudy: signed", { studyId });
    return out;
  } catch (error) {
    if (error instanceof NotReadyToSign) {
      throw new HttpsError("failed-precondition", error.needs.map((n) => NEED_TEXT[n]).join(" "), {
        error: "not_ready_to_sign",
        needs: error.needs,
      });
    }
    if (error instanceof WrongStateError) throw wrongState(error, "This study can't be signed in its current state.");
    throw error;
  }
});
