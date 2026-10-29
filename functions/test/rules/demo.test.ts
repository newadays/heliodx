/** F11 against the Auth, Firestore and Storage emulators: demo accounts, sample studies and the cap. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDemoStudyCore } from "../../src/callables/createDemoStudy";
import { DEMO_STUDIES_PER_HOUR } from "../../src/lib/demo";
import { addDemoUser, removeDemoUser } from "../../src/lib/demoAccounts";
import { SAMPLE_OWNER } from "../../src/lib/access";
import { claimAutopilot, runAutopilot, seedWorkspaceSamples } from "../../src/lib/demoSeed";
import { mockRewriter } from "../../src/callables/generatePatientSummary";

const PROJECT = "heliodx-rules-test-demo";
let app: App;
let db: Firestore;
let auth: Auth;
let bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `demo-${randomUUID()}`);
  db = getFirestore(app);
  auth = getAuth(app);
  bucket = getStorage(app).bucket();
  await bucket.file("samples/s1.jpg").save(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg" });
  await db.collection("samples").doc("s1").set({ title: "Sample 1 · chest X-ray", storagePath: "samples/s1.jpg", age: 34, sex: "F", indication: "Cough and fever for 3 days.", order: 0 });
  for (const [id, order] of [["s2", 1], ["s3", 2], ["s4", 3]] as const) {
    await bucket.file(`samples/${id}.jpg`).save(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg" });
    await db.collection("samples").doc(id).set({ title: `Sample ${order + 1} · chest X-ray`, storagePath: `samples/${id}.jpg`, age: 40 + order, sex: "M", indication: "Cough.", order });
  }
});
afterAll(async () => {
  await deleteApp(app);
});

const demoAuth = (uid: string) => ({ uid, token: { orgId: "demo", role: "demo" } });

describe("demo accounts", () => {
  it("creates a verified account in the demo org with a confirmed, simulated profile and a password link", async () => {
    const email = `judge-${randomUUID().slice(0, 8)}@example.org`;
    const account = await addDemoUser(db, auth, { email });
    expect(account.created).toBe(true);
    expect(account.resetLink).toBeTruthy();
    const user = await auth.getUser(account.uid);
    expect(user.emailVerified).toBe(true);
    expect(user.customClaims).toEqual({ orgId: "demo", role: "demo" });
    const profile = (await db.collection("users").doc(account.uid).get()).data()!;
    expect(profile).toMatchObject({ orgId: "demo", role: "demo", simulated: true, title: "Dr.", displayName: "Demo Clinician", email });
    expect(profile.orgConfirmedAt).toBeTruthy();
    expect((await db.collection("organizations").doc("demo").get()).get("demo")).toBe(true);

    const again = await addDemoUser(db, auth, { email: email.toUpperCase() });
    expect(again).toMatchObject({ uid: account.uid, created: false, resetLink: null });
  });

  it("never moves a real clinician into the demo org, or removes one", async () => {
    const email = `real-${randomUUID().slice(0, 8)}@kubimedical.org`;
    const real = await auth.createUser({ email });
    await auth.setCustomUserClaims(real.uid, { orgId: "kubi-medical", role: "clinician" });
    await db.collection("users").doc(real.uid).set({ orgId: "kubi-medical", role: "clinician" });
    await expect(addDemoUser(db, auth, { email })).rejects.toThrow("already_member_elsewhere");
    await expect(removeDemoUser(db, auth, bucket, email)).rejects.toThrow("not_a_demo_account");
    expect((await auth.getUser(real.uid)).customClaims).toEqual({ orgId: "kubi-medical", role: "clinician" });
  });

  it("removing an account deletes its uploads, subcollections and files; never another account's or the workspace samples", async () => {
    const mine = await addDemoUser(db, auth, { email: `judge-${randomUUID().slice(0, 8)}@example.org` });
    const other = await addDemoUser(db, auth, { email: `judge-${randomUUID().slice(0, 8)}@example.org` });
    const upload = async (uid: string) => {
      const ref = db.collection("studies").doc();
      await ref.set({ orgId: "demo", clinicianUid: uid, createdBy: uid, source: "upload", image: { storagePath: `studies/demo/${uid}/${ref.id}/original.png` } });
      await bucket.file(`studies/demo/${uid}/${ref.id}/original.png`).save(Buffer.from([1]), { contentType: "image/png" });
      return ref.id;
    };
    const studyId = await upload(mine.uid);
    await db.collection("studies").doc(studyId).collection("trace").doc("t").set({ name: "x" });
    const keptId = await upload(other.uid);
    const sample = await createDemoStudyCore({ db, bucket }, demoAuth(mine.uid), { sampleId: "s1" });

    expect(await removeDemoUser(db, auth, bucket, mine.email)).toEqual({ uid: mine.uid, studies: 1 });
    expect((await db.collection("studies").doc(studyId).get()).exists).toBe(false);
    expect((await db.collection("studies").doc(studyId).collection("trace").get()).empty).toBe(true);
    expect((await bucket.file(`studies/demo/${mine.uid}/${studyId}/original.png`).exists())[0]).toBe(false);
    expect((await bucket.file(`studies/demo/${other.uid}/${keptId}/original.png`).exists())[0]).toBe(true);
    expect((await db.collection("users").doc(mine.uid).get()).exists).toBe(false);
    await expect(auth.getUser(mine.uid)).rejects.toBeTruthy();
    expect((await db.collection("studies").doc(keptId).get()).exists).toBe(true);
    // A sample this account added belongs to the workspace and stays.
    expect((await db.collection("studies").doc(sample.studyId).get()).exists).toBe(true);
  });
});

describe("createDemoStudyCore", () => {
  it("creates a queued workspace sample with a synthetic patient and copies the image", async () => {
    const uid = `judge-${randomUUID()}`;
    const { studyId } = await createDemoStudyCore({ db, bucket }, demoAuth(uid), { sampleId: "s1" });
    const s = (await db.collection("studies").doc(studyId).get()).data()!;
    expect(s.caseId).toMatch(/^S-[A-Z2-9]{5}$/);
    expect(s).toMatchObject({
      orgId: "demo",
      clinicianUid: SAMPLE_OWNER,
      createdBy: uid,
      visibility: "workspace",
      status: "queued",
      source: "sample",
      patient: { name: "Sample Patient 1", phone: "+155501001", email: "sample.patient1@example.invalid" },
      demo: { sampleId: "s1", age: 34, sex: "F" },
      clinicalContext: "Cough and fever for 3 days.",
    });
    expect(s.image.storagePath).toBe(`studies/demo/samples/${studyId}/original.jpg`);
    const [meta] = await bucket.file(`studies/demo/samples/${studyId}/original.jpg`).getMetadata();
    expect(meta.metadata).toMatchObject({ clinicianUid: SAMPLE_OWNER, studyId, orgId: "demo" });
  });

  it("refuses non-demo accounts, unknown samples, and too many starts an hour", async () => {
    await expect(createDemoStudyCore({ db, bucket }, { uid: "u", token: { orgId: "kubi-medical", role: "clinician" } }, { sampleId: "s1" })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(createDemoStudyCore({ db, bucket }, demoAuth("u2"), { sampleId: "nope" })).rejects.toMatchObject({ code: "not-found" });
    const uid = `judge-${randomUUID()}`;
    for (let i = 0; i < DEMO_STUDIES_PER_HOUR; i++) await createDemoStudyCore({ db, bucket }, demoAuth(uid), { sampleId: "s1" });
    await expect(createDemoStudyCore({ db, bucket }, demoAuth(uid), { sampleId: "s1" })).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});

describe("demo worklist seed and autopilot (B21)", () => {
  it("seeds Sample Patients 1, 2 and 4 once for the workspace; only 4 runs the autopilot", async () => {
    const ids = await seedWorkspaceSamples(db, bucket, { force: true });
    expect(await seedWorkspaceSamples(db, bucket)).toEqual([]);
    const docs = await Promise.all(ids.map(async (id) => (await db.collection("studies").doc(id).get()).data()!));
    expect(docs.map((d) => d.patient.name).sort()).toEqual(["Sample Patient 1", "Sample Patient 2", "Sample Patient 4"]);
    expect(docs.every((d) => /^S-[A-Z2-9]{5}$/.test(d.caseId) && d.clinicianUid === SAMPLE_OWNER)).toBe(true);
    expect(docs.filter((d) => d.demo.autopilot === "share").map((d) => d.patient.name)).toEqual(["Sample Patient 4"]);
  });

  it("walks a drafted sample to shared by PDF with consent, once", async () => {
    const ref = db.collection("studies").doc();
    await ref.set({
      orgId: "demo",
      clinicianUid: SAMPLE_OWNER,
      source: "sample",
      caseId: "S-TEST4",
      clinicianName: "Dr. Demo Clinician",
      status: "ready",
      modality: "xray",
      studyType: "Chest X-ray (PA)",
      patient: { name: "Sample Patient 4", phone: "+155501004", email: "sample.patient4@example.invalid" },
      demo: { sampleId: "s4", autopilot: "share" },
      findings: [{ id: "f1", index: 0, title: "Lung areas are symmetric", description: "Lung areas are symmetric.", status: "pending", confidence: 90 }],
      clinicianSummary: {
        findings: "Lung areas are symmetric.",
        impression: ["Lung areas symmetric."],
        recommendation: "Correlate clinically.",
        highlights: [],
        generatedFromReviewHash: null,
        editedByClinician: false,
      },
      patientSummary: null,
      reviewHash: null,
      shares: [],
      pipeline: { runId: null, stepTimestamps: {} },
    });
    const claimed = await claimAutopilot(db, ref.id);
    expect(claimed).not.toBeNull();
    expect(await claimAutopilot(db, ref.id)).toBeNull();
    await runAutopilot(db, bucket, ref.id, claimed!, { rewrite: mockRewriter, sign: async (f) => `https://signed.example/${f.name}` });
    const done = (await ref.get()).data()!;
    expect(done.status).toBe("shared");
    expect(done.demo.autopilot).toBe("done");
    expect(done.signed.name).toBe("Dr. Demo Clinician");
    expect(done.shares).toHaveLength(1);
    expect(done.shares[0]).toMatchObject({ channel: "pdf", consent: { given: true } });
    expect(done.patientSummary.attribution).toBe("Reviewed and approved by Dr. Demo Clinician (simulated)");
  });
});
