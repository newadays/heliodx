/** B23 · Redrafts the clinician report in the background when the review decisions change. */
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

import { REGION } from "../config";
import { draftReport, needsDraft } from "../lib/reportDraft";

export const draftReportOnReview = onDocumentUpdated({ document: "studies/{studyId}", region: REGION, timeoutSeconds: 540, memory: "512MiB" }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!event.data || !needsDraft(before as never, after as never)) return;
  try {
    const outcome = await draftReport(getFirestore(), event.data.after.ref);
    logger.info("draftReport", { studyId: event.params.studyId, outcome });
  } catch (error) {
    logger.warn("draftReport failed", { studyId: event.params.studyId, error: error instanceof Error ? error.message : String(error) });
  }
});
