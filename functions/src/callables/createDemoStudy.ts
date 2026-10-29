/**
 * F11 + §4.11 · Adds a sample study from the curated NIH set. Samples belong
 * to the workspace (owner `SAMPLE_OWNER`): every demo account sees them and
 * may review or reset them; `createdBy` records who added it, for the
 * per-account hourly cap. Creates the study with a synthetic patient and
 * obviously fake contacts, then copies the sample image to the study's
 * `original.jpg`; the upload trigger runs the real pipeline from there.
 */
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { SAMPLE_OWNER } from "../lib/access";
import { uniqueCaseId } from "../lib/caseId";
import { studyDir } from "../lib/storagePaths";
import { DEMO_ORG, DEMO_PROFILE, DEMO_ROLE, DEMO_STUDIES_PER_HOUR, demoPatient, recentCount } from "../lib/demo";

export interface DemoSample {
  title: string;
  storagePath: string;
  contentType?: string;
  age?: number;
  sex?: "F" | "M";
  indication?: string;
  view?: string;
  /** Position in the picker; also numbers the synthetic patient. */
  order?: number;
}

export interface CreateDemoStudyDeps {
  db: Firestore;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
  now?: () => Date;
}

export async function createDemoStudyCore(
  deps: CreateDemoStudyDeps,
  auth: { uid: string; token: { orgId?: string; role?: string } },
  req: { sampleId?: unknown },
  /** Server-side seeding only (B21): no hourly cap; "share" walks the case to shared once drafted. */
  opts: { seed?: boolean; autopilot?: "share" } = {},
): Promise<{ studyId: string }> {
  const { db, bucket } = deps;
  const now = (deps.now ?? (() => new Date()))();
  if (auth.token.orgId !== DEMO_ORG || auth.token.role !== DEMO_ROLE) {
    throw new HttpsError("permission-denied", "Samples are for demo accounts.");
  }
  if (typeof req.sampleId !== "string" || !req.sampleId) throw new HttpsError("invalid-argument", "sampleId is required.");

  const sampleSnap = await db.collection("samples").doc(req.sampleId).get();
  if (!sampleSnap.exists) throw new HttpsError("not-found", "Sample not found.");
  const sample = sampleSnap.data() as DemoSample;

  // Few studies per demo account: filter the account's own studies in code
  // (no composite index needed).
  const mine = await db.collection("studies").where("createdBy", "==", auth.uid).select("createdAt").get();
  const starts = mine.docs.map((d) => (d.get("createdAt") as Timestamp | undefined)?.toMillis() ?? now.getTime());
  if (!opts.seed && recentCount(starts, now.getTime()) >= DEMO_STUDIES_PER_HOUR) {
    throw new HttpsError("resource-exhausted", `The demo allows ${DEMO_STUDIES_PER_HOUR} samples an hour. Try again later.`);
  }

  const ref = db.collection("studies").doc();
  const path = `${studyDir(DEMO_ORG, SAMPLE_OWNER, ref.id)}/original.jpg`;
  const patient = demoPatient((sample.order ?? 0) + 1);
  const caseId = await uniqueCaseId(db, DEMO_ORG, "sample");
  await ref.set({
    orgId: DEMO_ORG,
    caseId,
    clinicianUid: SAMPLE_OWNER,
    createdBy: auth.uid,
    visibility: "workspace",
    clinicianName: `${DEMO_PROFILE.title} ${DEMO_PROFILE.displayName}`,
    patient,
    demo: {
      sampleId: req.sampleId,
      sampleIndex: (sample.order ?? 0) + 1,
      age: sample.age ?? null,
      sex: sample.sex ?? null,
      indication: sample.indication ?? null,
      ...(opts.autopilot ? { autopilot: opts.autopilot } : {}),
    },
    modality: "xray",
    studyType: "",
    clinicalContext: sample.indication ?? "",
    source: "sample",
    image: { storagePath: path, thumbPath: null, width: 0, height: 0, bytes: 0, contentType: sample.contentType ?? "image/jpeg" },
    status: "queued",
    pipeline: { runId: null, stepTimestamps: {} },
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
    await bucket.file(sample.storagePath).copy(bucket.file(path), {
      contentType: sample.contentType ?? "image/jpeg",
      metadata: { clinicianUid: SAMPLE_OWNER, studyId: ref.id, orgId: DEMO_ORG },
    });
  } catch (error) {
    await ref.delete().catch(() => undefined);
    throw error;
  }
  logger.info("createDemoStudy: started", { studyId: ref.id, sampleId: req.sampleId });
  return { studyId: ref.id };
}

export const createDemoStudy = onCall<{ sampleId: string }, Promise<{ studyId: string }>>({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return createDemoStudyCore(
    { db: getFirestore(), bucket: getStorage().bucket() },
    { uid: request.auth.uid, token: request.auth.token as { orgId?: string; role?: string } },
    request.data ?? {},
  );
});
