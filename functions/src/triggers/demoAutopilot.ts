/**
 * B21 · Walks a seeded demo case (`demo.autopilot == "share"`) from drafted
 * to shared, so a new demo account's worklist has a finished case to open.
 * Runs only for the synthetic demo organization.
 */
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

import { REGION } from "../config";
import { DEMO_ORG } from "../lib/demo";
import { claimAutopilot, runAutopilot } from "../lib/demoSeed";

export const demoAutopilot = onDocumentUpdated({ document: "studies/{studyId}", region: REGION, timeoutSeconds: 300, memory: "512MiB" }, async (event) => {
  const after = event.data?.after.data();
  if (!after || after.orgId !== DEMO_ORG || after.status !== "ready" || after.demo?.autopilot !== "share") return;
  const studyId = event.params.studyId;
  const db = getFirestore();
  const study = await claimAutopilot(db, studyId);
  if (!study) return;
  try {
    await runAutopilot(db, getStorage().bucket(), studyId, study);
    logger.info("demoAutopilot: shared", { studyId });
  } catch (error) {
    logger.error("demoAutopilot failed", { studyId, error: error instanceof Error ? error.message : String(error) });
    await db.collection("studies").doc(studyId).update({ "demo.autopilot": "failed" }).catch(() => undefined);
  }
});
