/**
 * B24 · Writes the patient note as soon as the report is signed, from the
 * signed text only (B16 policy), so the Share step opens on a draft instead
 * of a button and a spinner. The clinician still confirms every next step
 * before anything is shared (F8).
 */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

import { generatePatientSummaryCore } from "../callables/generatePatientSummary";
import { REGION } from "../config";

/** Just signed, and no note written from this signature yet. */
export function justSigned(before: { status?: string } | undefined, after: { status?: string; patientSummary?: unknown; demo?: { autopilot?: string } } | undefined): boolean {
  if (!after || after.status !== "signed" || before?.status === "signed") return false;
  // The demo autopilot writes its own note in sequence.
  if (after.demo?.autopilot === "running") return false;
  return !after.patientSummary;
}

export const patientNoteOnSign = onDocumentUpdated({ document: "studies/{studyId}", region: REGION, timeoutSeconds: 120, memory: "512MiB" }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!justSigned(before, after) || !after) return;
  const studyId = event.params.studyId;
  try {
    const out = await generatePatientSummaryCore(getFirestore(), after.clinicianUid as string, { studyId });
    logger.info("patientNoteOnSign: written", { studyId, steps: out.steps, grade: out.readingGrade });
  } catch (error) {
    // The app's "Rewrite from report" calls the same code; nothing is lost.
    logger.warn("patientNoteOnSign failed", { studyId, error: error instanceof Error ? error.message : String(error) });
  }
});
