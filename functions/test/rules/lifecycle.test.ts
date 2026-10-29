/** §4.11 against the Firestore and Storage emulators: delete an upload, reset a sample, case ids, reserved labels. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteUploadCore, resetSampleCore } from "../../src/callables/studyLifecycle";
import { SAMPLE_OWNER } from "../../src/lib/access";
import { uniqueCaseId } from "../../src/lib/caseId";
import { validateUpload } from "../../src/lib/uploads";

const PROJECT = "heliodx-rules-test-lifecycle";
let app: App;
let db: Firestore;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `lifecycle-${randomUUID()}`);
  db = getFirestore(app);
  bucket = getStorage(app).bucket();
});
afterAll(async () => {
  await deleteApp(app);
});

async function upload(uid: string, status = "ready") {
  const ref = db.collection("studies").doc();
  const dir = `studies/demo/${uid}/${ref.id}`;
  await ref.set({ orgId: "demo", clinicianUid: uid, source: "upload", status, caseId: "U-TEST", image: { storagePath: `${dir}/original.png` } });
  await ref.collection("trace").doc("t").set({ name: "x" });
  for (const f of ["original.png", "thumb.jpg", "overlays/m.png"]) await bucket.file(`${dir}/${f}`).save(Buffer.from([1]));
  return { ref, dir };
}

describe("deleteUploadCore", () => {
  it("removes the upload with its trace and files", async () => {
    const uid = `judge-${randomUUID()}`;
    const { ref, dir } = await upload(uid);
    await deleteUploadCore({ db, bucket }, { uid, orgId: "demo" }, { studyId: ref.id });
    expect((await ref.get()).exists).toBe(false);
    expect((await ref.collection("trace").get()).empty).toBe(true);
    const [files] = await bucket.getFiles({ prefix: `${dir}/` });
    expect(files).toEqual([]);
  });

  it("refuses another clinician, signed uploads and samples", async () => {
    const uid = `judge-${randomUUID()}`;
    const { ref } = await upload(uid);
    await expect(deleteUploadCore({ db, bucket }, { uid: "someone-else", orgId: "demo" }, { studyId: ref.id })).rejects.toMatchObject({ code: "permission-denied" });
    const signed = await upload(uid, "signed");
    await expect(deleteUploadCore({ db, bucket }, uid, { studyId: signed.ref.id })).rejects.toMatchObject({ code: "failed-precondition" });
    const sample = db.collection("studies").doc();
    await sample.set({ orgId: "demo", clinicianUid: SAMPLE_OWNER, source: "sample", status: "ready" });
    await expect(deleteUploadCore({ db, bucket }, { uid, orgId: "demo" }, { studyId: sample.id })).rejects.toMatchObject({ code: "permission-denied" });
    expect((await ref.get()).exists).toBe(true);
  });
});

describe("resetSampleCore", () => {
  it("returns a shared sample to its fresh draft, for any member, and records the reset", async () => {
    const ref = db.collection("studies").doc();
    await ref.set({
      orgId: "demo",
      clinicianUid: SAMPLE_OWNER,
      source: "sample",
      status: "shared",
      findings: [
        { id: "f1", status: "edited", editedText: "Changed.", reviewedAt: Timestamp.now(), title: "A" },
        { id: "f2", status: "accepted", reviewedAt: Timestamp.now(), title: "B" },
      ],
      reviewHash: "h",
      clinicianSummary: { findings: "x", editedByClinician: true },
      report: { summary: {} },
      signed: { by: "judge-1", reportHash: "r" },
      patientSummary: { title: "t" },
      shares: [{ id: "s" }],
      demo: { sampleId: "s4", autopilot: "done" },
      pipeline: { stepTimestamps: { ready: Timestamp.now(), signed: Timestamp.now(), shared: Timestamp.now() } },
    });
    await resetSampleCore(db, { uid: "judge-2", orgId: "demo" }, { studyId: ref.id });
    const s = (await ref.get()).data()!;
    expect(s.status).toBe("ready");
    expect(s.findings).toEqual([
      { id: "f1", status: "pending", reviewedAt: null, title: "A" },
      { id: "f2", status: "pending", reviewedAt: null, title: "B" },
    ]);
    expect(s).toMatchObject({ reviewHash: null, clinicianSummary: null, patientSummary: null, shares: [] });
    expect(s.signed).toBeUndefined();
    expect(s.report).toBeUndefined();
    expect(s.demo.autopilot).toBeUndefined();
    expect(Object.keys(s.pipeline.stepTimestamps)).toEqual(["ready"]);
    const audit = (await ref.collection("audit").get()).docs.map((d) => d.data());
    expect(audit).toMatchObject([{ actor: "judge-2", action: "sample_reset", from: "shared", to: "ready" }]);
    const trace = (await ref.collection("trace").get()).docs.map((d) => d.data());
    expect(trace).toMatchObject([{ name: "reset_sample", stage: "reset", ok: true }]);
  });

  it("refuses uploads, other organizations and samples still being analyzed", async () => {
    const { ref } = await upload(`judge-${randomUUID()}`);
    await expect(resetSampleCore(db, { uid: "judge-2", orgId: "demo" }, { studyId: ref.id })).rejects.toMatchObject({ code: "permission-denied" });
    const sample = db.collection("studies").doc();
    await sample.set({ orgId: "demo", clinicianUid: SAMPLE_OWNER, source: "sample", status: "detecting", findings: [] });
    await expect(resetSampleCore(db, { uid: "x", orgId: "kubi-medical" }, { studyId: sample.id })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(resetSampleCore(db, { uid: "x", orgId: "demo" }, { studyId: sample.id })).rejects.toMatchObject({ code: "failed-precondition" });
  });
});

describe("case ids (§4.11)", () => {
  it("are prefixed by source and reserved, so a deleted study's id is never drawn again", async () => {
    const org = `org-${randomUUID().slice(0, 8)}`;
    // A fixed draw: the second request for the same id must draw again.
    const seq = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
    let i = 0;
    const random = () => seq[i++ % seq.length];
    const first = await uniqueCaseId(db, org, "upload", random);
    i = 0;
    const second = await uniqueCaseId(db, org, "upload", random);
    expect(first).toBe("U-AAAA");
    expect(second).not.toBe(first);
    expect(second).toMatch(/^U-[A-Z2-9]{4}$/);
    expect(await uniqueCaseId(db, org, "sample")).toMatch(/^S-[A-Z2-9]{5}$/);
  });
});

describe("upload labels", () => {
  it("rejects labels reserved for sample studies", () => {
    const base = { uploadId: "abcdefgh12", contribution: true, meta: { fileName: "a.png", format: "png", removedTags: 0, kept: {}, redactions: [], textKept: false, overrides: [], pixelHash: "a".repeat(64), width: 1, height: 1 } };
    expect(validateUpload({ ...base, details: { label: "Sample Patient 9" } })).toEqual({ ok: false, reason: "Reserved for sample studies." });
    expect(validateUpload({ ...base, details: { label: "  sample patient" } })).toMatchObject({ ok: false });
    expect(validateUpload({ ...base, details: { label: "Upload 1 · 28 Oct" } })).toMatchObject({ ok: true });
  });
});
