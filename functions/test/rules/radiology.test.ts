/** B14 against the Firestore emulator: the gate opens reads, the simulated readers sign, nudge and reassign, and signing waits for the read. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { requestRadiologistReadCore } from "../../src/callables/radiologistRead";
import { NotReadyToSign, signStudyCore } from "../../src/callables/signStudy";
import { resetSampleCore } from "../../src/callables/studyLifecycle";
import { SAMPLE_OWNER } from "../../src/lib/access";
import { reviewHash } from "../../src/lib/reviewHash";
import { runReads } from "../../src/radiology/reads";
import { ORG_A, PROJECT_ID, studyShell, UID_A1, UID_B1 } from "./helpers";

let app: App;
let db: Firestore;
const NOW = Date.now();
const MIN = 60_000;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: `${PROJECT_ID}-radiology` }, `radiology-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});
beforeEach(async () => {
  for (const c of ["studies", "organizations"]) {
    const all = await db.collection(c).get();
    await Promise.all(all.docs.map((d) => db.recursiveDelete(d.ref)));
  }
});

const findings = [{ id: "f1", index: 0, status: "accepted", title: "Heart size normal", description: "CTR 0.45.", confidence: 90, region: null, color: "#F5B400", reviewedAt: null }];
async function study(id: string, extra: Record<string, unknown> = {}): Promise<DocumentReference> {
  const ref = db.collection("studies").doc(id);
  await ref.set({
    ...studyShell(ORG_A, UID_A1),
    status: "ready",
    priority: "routine",
    createdAt: Timestamp.fromMillis(NOW - 10 * MIN),
    updatedAt: Timestamp.fromMillis(NOW - MIN),
    findings,
    clinicianSummary: { findings: "Heart size normal.", impression: ["No acute abnormality."], recommendation: "Routine follow-up.", highlights: [], generatedFromReviewHash: reviewHash(findings as never), editedByClinician: false },
    ...extra,
  });
  return ref;
}
const tick = async (now: number) => {
  const snap = await db.collection("studies").get();
  return runReads(db, now, snap.docs.map((d) => ({ id: d.id, ...(d.data() as { status: string }) })));
};
const read = async (ref: DocumentReference) => (await ref.get()).data()!.radiologistRead;
const names = async (ref: DocumentReference) => (await ref.collection("trace").get()).docs.map((d) => d.data()).sort((a, b) => a.at.toMillis() - b.at.toMillis() || a.seq - b.seq).map((t) => t.name);
const actions = async (ref: DocumentReference) => (await ref.collection("audit").get()).docs.map((d) => d.data().action).sort();

describe("radiologist reads", () => {
  it("opens a read for a critical case, the fast reader signs it at its ETA, and signing then succeeds", async () => {
    const ref = await study("crit", { priority: "critical", flags: { needsHuman: true } });
    expect(await tick(NOW)).toEqual({ opened: 1, stepped: 0 });
    expect(await read(ref)).toMatchObject({ required: true, reason: "critical", status: "assigned", profile: "fast", assigneeName: "Dr. N. Okafor", simulated: true });
    await expect(signStudyCore(db, UID_A1, { studyId: "crit", confirmImpression: true })).rejects.toMatchObject({ needs: ["close_radiologist_read"] });

    expect(await tick(NOW + MIN)).toEqual({ opened: 0, stepped: 0 });
    expect(await tick(NOW + 2 * MIN)).toEqual({ opened: 0, stepped: 1 });
    const done = (await ref.get()).data()!;
    expect(done.radiologistRead).toMatchObject({ status: "signed", note: "Agree with the draft findings." });
    expect(done.flags.needsHuman).toBe(false);
    expect(await names(ref)).toEqual(["assign_read", "sign_read"]);
    expect(await actions(ref)).toEqual(["radiologist_read_assigned", "radiologist_read_signed"]);
    await expect(signStudyCore(db, UID_A1, { studyId: "crit", confirmImpression: true })).resolves.toMatchObject({ reportHash: expect.any(String) });
  });

  it("uses the organization's roster: a slow reader signs at 6 min", async () => {
    await db.collection("organizations").doc(ORG_A).set({ radiologists: [{ id: "r-slow", name: "Dr. T. Bello", profile: "slow" }] });
    const ref = await study("slow", { priority: "urgent", flags: { needsHuman: true } });
    await tick(NOW);
    expect(await read(ref)).toMatchObject({ assignee: "r-slow", profile: "slow", reason: "needs_human" });
    await tick(NOW + 5 * MIN);
    expect((await read(ref)).status).toBe("assigned");
    await tick(NOW + 6 * MIN);
    expect((await read(ref)).status).toBe("signed");
  });

  it("nudges a silent reader, then reassigns the read to the fast reader, who signs", async () => {
    await db.collection("organizations").doc(ORG_A).set({
      radiologists: [
        { id: "r-silent", name: "Dr. H. Danjuma", profile: "silent" },
        { id: "r-fast", name: "Dr. N. Okafor", profile: "fast" },
      ],
    });
    const ref = await study("quiet", { priority: "urgent" });
    await requestRadiologistReadCore(db, UID_A1, { studyId: "quiet" }, NOW);
    // The rotation may pick either reader; force the silent one for this test.
    await ref.update({ "radiologistRead.assignee": "r-silent", "radiologistRead.assigneeName": "Dr. H. Danjuma", "radiologistRead.profile": "silent", "radiologistRead.eta": Timestamp.fromMillis(NOW + 4 * MIN) });
    await tick(NOW + 4 * MIN);
    expect((await read(ref)).nudgedAt).toBeTruthy();
    await tick(NOW + 5 * MIN);
    expect((await read(ref)).profile).toBe("silent");
    await tick(NOW + 6 * MIN);
    expect(await read(ref)).toMatchObject({ assignee: "r-fast", reassignedFrom: "Dr. H. Danjuma", status: "assigned", requestedBy: UID_A1, reason: "requested" });
    await tick(NOW + 8 * MIN);
    expect((await read(ref)).status).toBe("signed");
    expect(await names(ref)).toEqual(["assign_read", "nudge_read", "reassign_read", "sign_read"]);
  });

  it("leaves routine, unflagged cases alone; a weak accepted finding asks the clinician to request one", async () => {
    const ref = await study("weak", { findings: [{ ...findings[0], strength: "weak" }], clinicianSummary: { impression: ["x"], recommendation: "y", editedByClinician: true } });
    expect(await tick(NOW)).toEqual({ opened: 0, stepped: 0 });
    await expect(signStudyCore(db, UID_A1, { studyId: "weak", confirmImpression: true })).rejects.toBeInstanceOf(NotReadyToSign);
    await requestRadiologistReadCore(db, UID_A1, { studyId: "weak" }, NOW);
    expect(await read(ref)).toMatchObject({ reason: "weak_finding", requestedBy: UID_A1 });
  });

  it("refuses a request from another clinician, a second request and one before the draft", async () => {
    await study("own");
    await expect(requestRadiologistReadCore(db, { uid: UID_B1, orgId: "other-clinic" }, { studyId: "own" })).rejects.toMatchObject({ code: "permission-denied" });
    await requestRadiologistReadCore(db, UID_A1, { studyId: "own" });
    await expect(requestRadiologistReadCore(db, UID_A1, { studyId: "own" })).rejects.toMatchObject({ code: "already-exists" });
    await study("early", { status: "detecting" });
    await expect(requestRadiologistReadCore(db, UID_A1, { studyId: "early" })).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("a sample reset clears the read", async () => {
    const ref = await study("sample", { source: "sample", clinicianUid: SAMPLE_OWNER, orgId: ORG_A, priority: "critical" });
    await tick(NOW);
    expect(await read(ref)).toBeTruthy();
    await resetSampleCore(db, { uid: UID_A1, orgId: ORG_A }, { studyId: "sample" });
    expect(await read(ref)).toBeUndefined();
  });
});
