/** B17 against the Firestore and Storage emulators: the server gates, renders, records and audits each share. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotReadyToShare, shareStudyCore, type ShareDeps } from "../../src/callables/shareStudy";
import { WrongStateError } from "../../src/study/stateMachine";
import { ORG_A, studyShell, UID_A1, UID_A2 } from "./helpers";

const PROJECT = "heliodx-rules-test-share";
let app: App;
let db: Firestore;
let deps: ShareDeps;
const NOW = new Date("2026-10-28T12:00:00Z");

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `share-${randomUUID()}`);
  db = getFirestore(app);
  deps = {
    db,
    bucket: getStorage(app).bucket(),
    sign: async (file, expires) => `signed://${file.name}?until=${expires.toISOString()}`,
    now: () => NOW,
  };
});
afterAll(async () => {
  await deleteApp(app);
});

const steps = (confirmed: boolean) => [
  { text: "Your doctor will check how you feel.", mapsTo: 0, confirmed },
  { text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed },
];

async function readyStudy(over: Record<string, unknown> = {}, summaryOver: Record<string, unknown> = {}) {
  const ref = db.collection("studies").doc(`share-${randomUUID()}`);
  const shell = studyShell(ORG_A, UID_A1);
  await ref.set({
    ...shell,
    image: { ...shell.image, storagePath: `studies/${ORG_A}/${UID_A1}/${ref.id}/original.jpg` },
    patient: { name: "Jane Doe", phone: "+15550100", email: "jane@example.invalid" },
    status: "patient_summary_ready",
    signed: { by: UID_A1, name: "Dr. A. Smith", reportHash: "sha256:r" },
    report: { studyType: "Chest X-ray", summary: { findings: "", impression: ["Right lower zone opacity."], recommendation: "Clinical correlation. Repeat chest X-ray in 6 weeks." } },
    patientSummary: {
      title: "A note from Dr. A. Smith about your chest X-ray",
      body: "Your X-ray shows a cloudy patch in your right lung.",
      nextSteps: steps(true),
      reviewedBy: "Dr. A. Smith",
      attribution: "Reviewed and approved by Dr. A. Smith",
      generatedFromReportHash: "sha256:r",
      editedByClinician: false,
      generated: { body: "Your X-ray shows a cloudy patch in your right lung.", steps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."] },
      ...summaryOver,
    },
    shares: [],
    ...over,
  });
  return ref;
}
const audit = async (ref: FirebaseFirestore.DocumentReference) => (await ref.collection("audit").get()).docs.map((d) => d.data());

describe("shareStudyCore", () => {
  it("first share: renders and stores the PDF, signs the download, records decisions and consent, moves to shared", async () => {
    const ref = await readyStudy();
    const out = await shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "pdf", consent: true, consentNote: "Agreed at the visit." });
    expect(out.downloadUrl).toMatch(/^signed:\/\/studies\/kubi-medical\/.*\/shares\/.*\.pdf\?until=2026-10-28T12:15:00.000Z$/);
    expect(out.link).toBeUndefined();

    const snap = await ref.get();
    expect(snap.get("status")).toBe("shared");
    const [share] = snap.get("shares");
    expect(share).toMatchObject({
      id: out.shareId,
      channel: "pdf",
      target: "",
      consent: { given: true, note: "Agreed at the visit.", by: UID_A1 },
      generatedFromReportHash: "sha256:r",
      summaryEdited: false,
    });
    expect(share.pdfPath).toMatch(new RegExp(`^studies/${ORG_A}/${UID_A1}/${ref.id}/shares/[a-f0-9]{16}\\.pdf$`));
    const [file] = await deps.bucket.file(share.pdfPath).download();
    expect(file.subarray(0, 5).toString()).toBe("%PDF-");

    const entries = await audit(ref);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "study_shared", from: "patient_summary_ready", to: "shared", actor: `user:${UID_A1}` });
    expect(entries[0].detail).toMatchObject({ shareId: out.shareId, channel: "pdf", consentNote: "Agreed at the visit.", summaryEdited: false });
  });

  it("§4.6a: a PDF needs no consent and no step ticks; consent is recorded as not given", async () => {
    const ref = await readyStudy({}, { nextSteps: steps(false) });
    await shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "pdf", consent: false });
    const second = await shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "pdf", consent: true });
    expect(second.link).toBeUndefined();
    const snap = await ref.get();
    expect(snap.get("status")).toBe("shared");
    expect(snap.get("shares").map((s: { channel: string; consent: { given: boolean } }) => [s.channel, s.consent.given])).toEqual([
      ["pdf", false],
      ["pdf", true],
    ]);
    expect((await audit(ref)).map((a) => `${a.from}>${a.to}`)).toEqual(expect.arrayContaining(["patient_summary_ready>shared", "shared>shared"]));
  });

  it("§4.6a: WhatsApp and email are refused for now and write nothing", async () => {
    const ref = await readyStudy();
    for (const channel of ["whatsapp", "email"] as const) {
      await expect(shareStudyCore(deps, UID_A1, { studyId: ref.id, channel, consent: true })).rejects.toMatchObject({ code: "invalid-argument" });
    }
    expect((await ref.get()).get("shares")).toEqual([]);
    expect(await audit(ref)).toEqual([]);
  });

  it("records an edited step against the generated text", async () => {
    const ref = await readyStudy({}, { nextSteps: [steps(true)[0], { text: "Another X-ray in 6 weeks will check it has cleared.", mapsTo: 1, confirmed: true }], editedByClinician: true });
    await shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "pdf", consent: true });
    const [share] = (await ref.get()).get("shares");
    expect(share.summaryEdited).toBe(true);
    expect(share.steps[1]).toMatchObject({ edited: true });
  });

  it("refuses an edit that adds an instruction the signed report lacks; writes nothing", async () => {
    const ref = await readyStudy({}, { nextSteps: [steps(false)[0], { text: "Take antibiotics for 7 days.", mapsTo: 1, confirmed: true }] });
    const err = await shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "pdf", consent: false }).catch((e) => e);
    expect(err).toBeInstanceOf(NotReadyToShare);
    expect(err.needs).toEqual(["step_adds_instruction"]);
    expect(err.steps).toEqual([2]);
    const snap = await ref.get();
    expect(snap.get("status")).toBe("patient_summary_ready");
    expect(snap.get("shares")).toEqual([]);
    expect(await audit(ref)).toEqual([]);
    const [files] = await deps.bucket.getFiles({ prefix: `studies/${ORG_A}/${UID_A1}/${ref.id}/shares/` });
    expect(files).toEqual([]);
  });

  it("refuses before the patient summary is ready, for another clinician, and for an unknown channel", async () => {
    const signed = await readyStudy({ status: "signed" });
    await expect(shareStudyCore(deps, UID_A1, { studyId: signed.id, channel: "pdf", consent: true })).rejects.toBeInstanceOf(WrongStateError);
    const ref = await readyStudy();
    await expect(shareStudyCore(deps, UID_A2, { studyId: ref.id, channel: "pdf", consent: true })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(shareStudyCore(deps, UID_A1, { studyId: ref.id, channel: "sms" as never, consent: true })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("re-checks inside the transaction and deletes the PDF when the study changed meanwhile", async () => {
    const ref = await readyStudy();
    const racing: ShareDeps = {
      ...deps,
      sign: async (file, expires) => {
        // The note is edited to add an instruction while the PDF is being prepared.
        await ref.update({ "patientSummary.nextSteps": [steps(true)[0], { text: "Take antibiotics for 7 days.", mapsTo: 1, confirmed: true }] });
        return deps.sign!(file, expires);
      },
    };
    const err = await shareStudyCore(racing, UID_A1, { studyId: ref.id, channel: "pdf", consent: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NotReadyToShare);
    expect((await ref.get()).get("status")).toBe("patient_summary_ready");
    const [files] = await deps.bucket.getFiles({ prefix: `studies/${ORG_A}/${UID_A1}/${ref.id}/shares/` });
    expect(files).toEqual([]);
  });
});
