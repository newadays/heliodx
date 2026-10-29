/** §4.10 against the Firestore and Storage emulators: a staged, de-identified upload becomes a study. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startUploadCore } from "../../src/callables/startUpload";

const PROJECT = "heliodx-rules-test-upload";
let app: App;
let db: Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `upload-${randomUUID()}`);
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});
afterAll(async () => {
  await deleteApp(app);
});

const meta = { fileName: "study.dcm", format: "dicom", removedTags: 14, kept: { modality: "CR" }, redactions: [], textKept: false, overrides: [], pixelHash: "b".repeat(64), width: 1024, height: 1024 };

async function stage(uid: string, contentType = "image/png") {
  const uploadId = randomUUID().replace(/-/g, "").slice(0, 16);
  await bucket.file(`studies/kubi-medical/${uid}/staging/${uploadId}.png`).save(Buffer.from([0x89, 0x50, 0x4e, 0x47]), { contentType });
  return uploadId;
}

describe("startUploadCore", () => {
  it("creates a queued study with the label, details and contribution, moves the image and clears staging", async () => {
    const uid = `clin-${randomUUID()}`;
    const uploadId = await stage(uid);
    const out = await startUploadCore(
      { db, bucket },
      { uid, token: { orgId: "kubi-medical", role: "clinician" } },
      { uploadId, details: { label: "Upload 1 · 28 Oct", age: 47, sex: "F", view: "PA", indication: "Cough." }, meta, contribution: true },
    );
    const s = (await db.collection("studies").doc(out.studyId).get()).data()!;
    expect(s).toMatchObject({
      orgId: "kubi-medical",
      clinicianUid: uid,
      status: "queued",
      source: "upload",
      patient: { name: "Upload 1 · 28 Oct" },
      details: { age: 47, sex: "F", view: "PA" },
      clinicalContext: "Cough.",
      upload: { format: "dicom", removedTags: 14, contribution: { given: true } },
    });
    expect(s.caseId).toMatch(/^U-[A-Z2-9]{4}$/);
    expect((await bucket.file(`studies/kubi-medical/${uid}/${out.studyId}/original.png`).exists())[0]).toBe(true);
    expect((await bucket.file(`studies/kubi-medical/${uid}/staging/${uploadId}.png`).exists())[0]).toBe(false);
  });

  it("refuses without the research contribution, without staging, or a non-PNG", async () => {
    const uid = `clin-${randomUUID()}`;
    const auth = { uid, token: { orgId: "kubi-medical", role: "clinician" } };
    const details = { label: "Upload 2" };
    await expect(startUploadCore({ db, bucket }, auth, { uploadId: await stage(uid), details, meta, contribution: false })).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(startUploadCore({ db, bucket }, auth, { uploadId: "missing0000", details, meta, contribution: true })).rejects.toMatchObject({ code: "not-found" });
    await expect(startUploadCore({ db, bucket }, auth, { uploadId: await stage(uid, "image/jpeg"), details, meta, contribution: true })).rejects.toMatchObject({ code: "invalid-argument" });
    const other = await stage(`someone-${randomUUID()}`);
    await expect(startUploadCore({ db, bucket }, auth, { uploadId: other, details, meta, contribution: true })).rejects.toMatchObject({ code: "not-found" });
    expect((await db.collection("studies").where("clinicianUid", "==", uid).get()).empty).toBe(true);
  });
});
