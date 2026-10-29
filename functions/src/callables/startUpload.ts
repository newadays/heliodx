/**
 * §4.10 · Turns a staged, de-identified upload into a study and starts the
 * analysis (the Storage trigger runs the pipeline when the image lands at the
 * study's path). Re-validates on the server: owner, size and type of the
 * staged object; the details are labels only (never a real name).
 */
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { uniqueCaseId } from "../lib/caseId";
import { DEMO_ROLE, DEMO_STUDIES_PER_HOUR, recentCount } from "../lib/demo";
import { stagingPath, studyDir } from "../lib/storagePaths";
import { CONTRIBUTION_TEXT, UPLOAD_MAX_BYTES, validateUpload } from "../lib/uploads";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export interface StartUploadDeps {
  db: Firestore;
  bucket: Bucket;
  now?: () => Date;
}

export async function startUploadCore(
  deps: StartUploadDeps,
  auth: { uid: string; token: { orgId?: string; role?: string } },
  req: { uploadId?: unknown; details?: unknown; meta?: unknown; contribution?: unknown },
): Promise<{ studyId: string; caseId: string }> {
  const { db, bucket } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const orgId = auth.token.orgId;
  if (!orgId) throw new HttpsError("permission-denied", "Join an organization first.");
  const v = validateUpload(req);
  if (!v.ok) throw new HttpsError("invalid-argument", v.reason);

  const staged = bucket.file(stagingPath(orgId, auth.uid, req.uploadId as string));
  const [exists] = await staged.exists();
  if (!exists) throw new HttpsError("not-found", "The uploaded file is gone. Upload it again.");
  const [meta] = await staged.getMetadata();
  if (meta.contentType !== "image/png" || Number(meta.size) > UPLOAD_MAX_BYTES) {
    await staged.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw new HttpsError("invalid-argument", "The staged file isn't a de-identified PNG under 20 MB.");
  }

  // Demo accounts share the per-hour cap with samples.
  if (auth.token.role === DEMO_ROLE) {
    const mine = await db.collection("studies").where("createdBy", "==", auth.uid).select("createdAt").get();
    const starts = mine.docs.map((d) => (d.get("createdAt") as Timestamp | undefined)?.toMillis() ?? now.getTime());
    if (recentCount(starts, now.getTime()) >= DEMO_STUDIES_PER_HOUR) {
      throw new HttpsError("resource-exhausted", `The demo allows ${DEMO_STUDIES_PER_HOUR} studies an hour. Try again later.`);
    }
  }

  const profile = await db.collection("users").doc(auth.uid).get();
  const clinicianName = [profile.get("title"), profile.get("displayName")].filter(Boolean).join(" ") || "Clinician";
  const ref = db.collection("studies").doc();
  const caseId = await uniqueCaseId(db, orgId, "upload");
  const path = `${studyDir(orgId, auth.uid, ref.id)}/original.png`;
  const { details, meta: upload } = v;
  await ref.set({
    orgId,
    caseId,
    clinicianUid: auth.uid,
    createdBy: auth.uid,
    visibility: "owner",
    clinicianName,
    patient: { name: details.label },
    details: { age: details.age, sex: details.sex, indication: details.indication || null, view: details.view },
    upload: { ...upload, contribution: { given: true, text: CONTRIBUTION_TEXT, at: Timestamp.fromDate(now) } },
    modality: "xray",
    studyType: "",
    clinicalContext: details.indication,
    source: "upload",
    image: { storagePath: path, thumbPath: null, width: upload.width, height: upload.height, bytes: Number(meta.size) || 0, contentType: "image/png" },
    status: "queued",
    pipeline: { runId: null, stepTimestamps: { queued: Timestamp.fromDate(now) } },
    findings: [],
    clinicianSummary: null,
    patientSummary: null,
    reviewHash: null,
    shares: [],
    deletedAt: null,
    createdAt: Timestamp.fromDate(now),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await staged.copy(bucket.file(path), { contentType: "image/png", metadata: { clinicianUid: auth.uid, studyId: ref.id, orgId } });
    await staged.delete({ ignoreNotFound: true });
  } catch (error) {
    await ref.delete().catch(() => undefined);
    throw error;
  }
  logger.info("startUpload: study created", { studyId: ref.id, format: upload.format, redactions: upload.redactions.length });
  return { studyId: ref.id, caseId };
}

export const startUpload = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return startUploadCore(
    { db: getFirestore(), bucket: getStorage().bucket() },
    { uid: request.auth.uid, token: request.auth.token as { orgId?: string; role?: string } },
    request.data ?? {},
  );
});
