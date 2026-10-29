/** B15 against the Firestore emulator: signing writes everything in one transaction, or nothing. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signStudyCore, NotReadyToSign } from "../../src/callables/signStudy";
import { reviewHash } from "../../src/lib/reviewHash";
import { WrongStateError } from "../../src/study/stateMachine";
import { ORG_A, studyShell, UID_A1, UID_A2 } from "./helpers";

let app: App;
let db: Firestore;
beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "heliodx-rules-test-sign" }, `sign-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const findings = [
  { id: "f1", index: 0, status: "accepted", title: "Heart size normal", description: "CTR 0.45.", confidence: 90, region: null, color: "#F5B400", reviewedAt: null },
  { id: "f2", index: 1, status: "rejected", title: "Other", description: "x", confidence: 50, region: null, color: "#4A90E2", reviewedAt: null },
];
async function study(over: Record<string, unknown> = {}) {
  const ref = db.collection("studies").doc(`sign-${randomUUID()}`);
  await ref.set({
    ...studyShell(ORG_A, UID_A1),
    status: "ready",
    studyType: "Chest X-ray (PA)",
    findings,
    clinicianSummary: {
      findings: "Heart size normal.",
      impression: ["No acute abnormality."],
      recommendation: "Routine follow-up.",
      highlights: [],
      generatedFromReviewHash: reviewHash(findings as never),
      editedByClinician: false,
    },
    ...over,
  });
  return ref;
}
const audit = async (ref: FirebaseFirestore.DocumentReference) => (await ref.collection("audit").get()).docs.map((d) => d.data().action);

describe("signStudyCore", () => {
  it("signs a reviewed study: frozen report, hash, signer, status, audit", async () => {
    const ref = await study();
    const at = new Date("2026-10-27T21:00:00Z");
    const out = await signStudyCore(db, UID_A1, { studyId: ref.id, confirmImpression: true, device: "web / Mozilla/5.0 (Macintosh)" }, at);
    const snap = await ref.get();
    expect(snap.get("status")).toBe("signed");
    expect(snap.get("signed.by")).toBe(UID_A1);
    expect(snap.get("signed.reportHash")).toBe(out.reportHash);
    expect(snap.get("signed.device")).toBe("web / Mozilla/5.0 (Macintosh)");
    expect(snap.get("signed.impressionConfirmed")).toBe(true);
    expect(snap.get("report.summary.recommendation")).toBe("Routine follow-up.");
    expect(snap.get("report.signedAt")).toBe(at.toISOString());
    expect(out.reportHash).toMatch(/^sha256:/);
    expect(await audit(ref)).toEqual(["study_signed"]);
  });

  it("refuses, and writes nothing, when the impression is an unconfirmed AI draft", async () => {
    const ref = await study();
    await expect(signStudyCore(db, UID_A1, { studyId: ref.id })).rejects.toMatchObject({ needs: ["confirm_impression"] });
    expect((await ref.get()).get("status")).toBe("ready");
    expect(await audit(ref)).toEqual([]);
  });

  it("refuses while a finding is undecided", async () => {
    const ref = await study({ findings: [{ ...findings[0], status: "pending" }] });
    const err = await signStudyCore(db, UID_A1, { studyId: ref.id, confirmImpression: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NotReadyToSign);
    expect(err.needs).toContain("decide_every_finding");
  });

  it("only the owning clinician may sign", async () => {
    const ref = await study();
    await expect(signStudyCore(db, UID_A2, { studyId: ref.id, confirmImpression: true })).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("cannot sign a study that is still being drafted, or sign twice", async () => {
    const drafting = await study({ status: "detecting" });
    await expect(signStudyCore(db, UID_A1, { studyId: drafting.id, confirmImpression: true })).rejects.toBeInstanceOf(WrongStateError);
    const ref = await study();
    await signStudyCore(db, UID_A1, { studyId: ref.id, confirmImpression: true });
    await expect(signStudyCore(db, UID_A1, { studyId: ref.id, confirmImpression: true })).rejects.toBeInstanceOf(WrongStateError);
  });
});
