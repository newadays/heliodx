/** B16 against the Firestore emulator: the patient summary is written from the signed report only. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generatePatientSummaryCore, mockRewriter, type Rewriter } from "../../src/callables/generatePatientSummary";
import { signStudyCore } from "../../src/callables/signStudy";
import { reviewHash } from "../../src/lib/reviewHash";
import { WrongStateError } from "../../src/study/stateMachine";
import { ORG_A, studyShell, UID_A1, UID_A2 } from "./helpers";

let app: App;
let db: Firestore;
beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "heliodx-rules-test-patient" }, `patient-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const findings = [
  { id: "f1", index: 0, status: "accepted", title: "Right lower zone opacity", description: "Patchy.", confidence: 80, region: null, color: "#F5B400", reviewedAt: null },
];
const RECOMMENDATION = "Clinical correlation. Repeat chest X-ray in 6 weeks.";

async function signedStudy(over: Record<string, unknown> = {}) {
  const ref = db.collection("studies").doc(`ps-${randomUUID()}`);
  await ref.set({
    ...studyShell(ORG_A, UID_A1),
    status: "ready",
    studyType: "Chest X-ray (PA)",
    clinicianName: "Dr. A. Smith",
    findings,
    clinicianSummary: {
      findings: "Patchy opacity in the right lower zone.",
      impression: ["Right lower zone opacity, possibly pneumonia."],
      recommendation: RECOMMENDATION,
      highlights: [],
      generatedFromReviewHash: reviewHash(findings as never),
      editedByClinician: false,
    },
    ...over,
  });
  await signStudyCore(db, UID_A1, { studyId: ref.id, confirmImpression: true });
  return ref;
}
const audit = async (ref: FirebaseFirestore.DocumentReference) =>
  (await ref.collection("audit").orderBy("at").get()).docs.map((d) => d.data().action);

const good: Rewriter = async () => ({
  body: "Your X-ray shows a cloudy patch in your right lung. It may be pneumonia.",
  nextSteps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."],
});

describe("generatePatientSummaryCore", () => {
  it("writes the summary from the signed report and moves to patient_summary_ready", async () => {
    const ref = await signedStudy();
    const seen: unknown[] = [];
    const out = await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, async (signed, sentences, feedback) => {
      seen.push({ signed, sentences, feedback });
      return good(signed, sentences, feedback);
    });
    const snap = await ref.get();
    expect(snap.get("status")).toBe("patient_summary_ready");
    const ps = snap.get("patientSummary");
    expect(ps.title).toBe("A note from Dr. A. Smith about your chest X-ray");
    expect(ps.attribution).toBe("Reviewed and approved by Dr. A. Smith");
    expect(ps.nextSteps).toEqual([
      { text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: false },
      { text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed: false },
    ]);
    expect(ps.generatedFromReportHash).toBe(snap.get("signed.reportHash"));
    expect(out).toMatchObject({ steps: 2, flagged: 0, attempts: 1 });
    expect(seen).toEqual([
      {
        signed: {
          studyType: "Chest X-ray (PA)",
          findings: "Patchy opacity in the right lower zone.",
          impression: ["Right lower zone opacity, possibly pneumonia."],
          recommendation: RECOMMENDATION,
        },
        sentences: ["Clinical correlation.", "Repeat chest X-ray in 6 weeks."],
        feedback: "",
      },
    ]);
    expect(await audit(ref)).toEqual(["study_signed", "patient_summary_generated"]);
  });

  it("uses the frozen report, not a clinician summary changed after signing", async () => {
    const ref = await signedStudy();
    await ref.update({ "clinicianSummary.recommendation": "Start antibiotics for 7 days." });
    let sentences: string[] = [];
    await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, async (s, sent, f) => {
      sentences = sent;
      return good(s, sent, f);
    });
    expect(sentences).toEqual(["Clinical correlation.", "Repeat chest X-ray in 6 weeks."]);
  });

  it("retries once with feedback, then falls back to the signed sentence", async () => {
    const ref = await signedStudy();
    const feedbacks: string[] = [];
    const out = await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, async (_s, _sent, feedback) => {
      feedbacks.push(feedback);
      return { body: "Your X-ray shows a cloudy patch.", nextSteps: ["Your doctor will check how you feel.", "Take antibiotics for 7 days."] };
    });
    expect(out).toMatchObject({ attempts: 2, flagged: 1 });
    expect(feedbacks[0]).toBe("");
    expect(feedbacks[1]).toContain("Step 2 added");
    const step = (await ref.get()).get("patientSummary.nextSteps")[1];
    expect(step).toEqual({ text: "Repeat chest X-ray in 6 weeks.", mapsTo: 1, confirmed: false, fromSignedText: true });
  });

  it("regenerates in patient_summary_ready without changing status", async () => {
    const ref = await signedStudy();
    await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, mockRewriter);
    await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, good);
    const snap = await ref.get();
    expect(snap.get("status")).toBe("patient_summary_ready");
    expect(snap.get("patientSummary").nextSteps[0].text).toBe("Your doctor will check how you feel.");
    expect(await audit(ref)).toEqual(["study_signed", "patient_summary_generated", "patient_summary_generated"]);
  });

  it("marks a simulated signer", async () => {
    const uid = `sim-${randomUUID()}`;
    const ref = db.collection("studies").doc(`ps-${randomUUID()}`);
    await db.collection("users").doc(uid).set({ simulated: true });
    await ref.set({
      ...studyShell(ORG_A, UID_A1),
      status: "signed",
      report: { studyType: "Chest X-ray", summary: { findings: "", impression: ["Normal."], recommendation: "No follow-up." } },
      signed: { by: uid, name: "Dr. B. Lee", reportHash: "sha256:x" },
    });
    await generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, mockRewriter);
    expect((await ref.get()).get("patientSummary.attribution")).toBe("Reviewed and approved by Dr. B. Lee (simulated)");
  });

  it("refuses before signing, after sharing, and for another clinician", async () => {
    const draft = db.collection("studies").doc(`ps-${randomUUID()}`);
    await draft.set({ ...studyShell(ORG_A, UID_A1), status: "ready" });
    await expect(generatePatientSummaryCore(db, UID_A1, { studyId: draft.id }, good)).rejects.toBeInstanceOf(WrongStateError);

    const ref = await signedStudy();
    await expect(generatePatientSummaryCore(db, UID_A2, { studyId: ref.id }, good)).rejects.toMatchObject({ code: "permission-denied" });
    await ref.update({ status: "shared" });
    await expect(generatePatientSummaryCore(db, UID_A1, { studyId: ref.id }, good)).rejects.toBeInstanceOf(WrongStateError);
  });
});
