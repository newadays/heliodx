/**
 * HelioDX Cloud Functions entry point.
 *
 * Every export here becomes a deployed function. Keep this file to exports
 * and global options; implementation lives under callables/ and triggers/.
 */
import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

import { REGION } from "./config";

initializeApp();

setGlobalOptions({
  region: REGION,
  // Budget guard while the product is pre-launch; raise per function later.
  maxInstances: 10,
});

export { warmModels } from "./callables/warmModels";
export { retryPipeline } from "./callables/retryPipeline";
export { regenerateSummaries } from "./callables/regenerateSummaries";
export { onStudyImageUploaded } from "./triggers/onStudyImageUploaded";
export { requeueStudies } from "./scheduled/requeueStudies";
export { signStudy } from "./callables/signStudy";
export { generatePatientSummary } from "./callables/generatePatientSummary";
export { shareStudy } from "./callables/shareStudy";
export { createDemoStudy } from "./callables/createDemoStudy";
export { startUpload } from "./callables/startUpload";
export { deleteUpload, resetSample } from "./callables/studyLifecycle";
export { demoAutopilot } from "./triggers/demoAutopilot";
export { draftReportOnReview } from "./triggers/draftReport";
export { patientNoteOnSign } from "./triggers/patientNoteOnSign";
