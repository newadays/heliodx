import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onObjectFinalized } from "firebase-functions/v2/storage";

import { STORAGE_REGION } from "../config";
import { parseOriginalPath } from "../lib/storagePaths";
import { runPipeline, shouldStart, type StudyForPipeline } from "../pipeline/run";

/**
 * Starts the AI pipeline when a study image lands in Storage. Thumbnails and
 * every other object under the study prefix are ignored by the path test.
 * Retries are off: a redelivered event is caught by `shouldStart` and a
 * genuine failure is recorded on the study for the clinician to retry.
 */
export const onStudyImageUploaded = onObjectFinalized(
  // Same region as the bucket (required) and the GPU service it calls.
  { region: STORAGE_REGION, memory: "1GiB", timeoutSeconds: 300, retry: false, maxInstances: 20 },
  async (event) => {
    const parsed = parseOriginalPath(event.data.name ?? "");
    if (!parsed) return;
    const { orgId, uid: pathUid, studyId } = parsed;

    const db = getFirestore();
    const ref = db.collection("studies").doc(studyId);
    const snap = await ref.get();
    const study = snap.exists ? (snap.data() as StudyForPipeline & { orgId?: string; clinicianUid?: string }) : null;

    const decision = shouldStart(study, event.id);
    if (!decision.start || !study) {
      logger.info("pipeline skipped", { studyId, reason: decision.reason });
      return;
    }
    if (study.orgId !== orgId) {
      logger.error("pipeline skipped: path/org mismatch", { studyId, pathOrg: orgId });
      return;
    }
    if (pathUid && pathUid !== study.clinicianUid) {
      logger.error("pipeline skipped: path/owner mismatch", { studyId });
      return;
    }
    const uploader = event.data.metadata?.clinicianUid;
    if (uploader && uploader !== study.clinicianUid) {
      logger.error("pipeline skipped: uploader is not the study owner", { studyId });
      return;
    }

    await runPipeline(ref, study, event.id, { bucket: event.data.bucket });
  },
);
