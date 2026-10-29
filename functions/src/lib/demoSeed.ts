/**
 * B21 + §4.11 · The workspace's sample studies, so the guided path (SPEC
 * §1.2) opens on real cases: Sample Patients 1 and 2 drafted and ready to
 * review, Sample Patient 4 signed and shared by PDF. Seeded once for the demo
 * organization and shared by every demo account (anyone may reset them). Every case runs the real
 * pipeline; the autopilot (triggers/demoAutopilot.ts) walks the "shared" one
 * through review, a simulated radiologist read when the gate needs one, signing, the patient note and a PDF share once drafted,
 * with the same server code a clinician's clicks go through.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";

import { createDemoStudyCore } from "../callables/createDemoStudy";
import { generatePatientSummaryCore, type Rewriter } from "../callables/generatePatientSummary";
import { shareStudyCore, type ShareDeps } from "../callables/shareStudy";
import { signStudyCore } from "../callables/signStudy";
import { readNeed } from "../radiology/gate";
import { assignRead, stepRead } from "../radiology/reads";
import { DEFAULT_ROSTER } from "../radiology/roster";
import { SAMPLE_OWNER } from "./access";
import { DEMO_ORG, DEMO_ROLE } from "./demo";
import { reviewHash } from "./reviewHash";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/** Picker order (0-based) of the samples seeded, and what happens to each. */
export const SEED_PLAN: { order: number; autopilot?: "share" }[] = [{ order: 0 }, { order: 1 }, { order: 3, autopilot: "share" }];

/** The workspace's sample studies, oldest first. */
export async function workspaceSamples(db: Firestore) {
  return db.collection("studies").where("orgId", "==", DEMO_ORG).where("clinicianUid", "==", SAMPLE_OWNER).get();
}

/** Seeds the sample studies unless the workspace has them; returns the new ids (none when present). */
export async function seedWorkspaceSamples(db: Firestore, bucket: Bucket, opts: { force?: boolean } = {}): Promise<string[]> {
  if (!opts.force && !(await workspaceSamples(db)).empty) return [];
  const samples = await db.collection("samples").orderBy("order").get();
  const byOrder = new Map(samples.docs.map((d) => [d.get("order") as number, d.id]));
  const ids: string[] = [];
  // Oldest first, so "Newest first" lists Sample Patient 1 at the top.
  for (const step of [...SEED_PLAN].reverse()) {
    const sampleId = byOrder.get(step.order);
    if (!sampleId) continue;
    const { studyId } = await createDemoStudyCore(
      { db, bucket },
      { uid: SAMPLE_OWNER, token: { orgId: DEMO_ORG, role: DEMO_ROLE } },
      { sampleId },
      { seed: true, autopilot: step.autopilot },
    );
    ids.push(studyId);
  }
  return ids;
}

interface AutopilotStudy {
  clinicianUid: string;
  status: string;
  findings?: { status: string; editedText?: string; id: string }[];
  clinicianSummary?: Record<string, unknown> | null;
  patientSummary?: { nextSteps?: { confirmed: boolean }[] } | null;
  demo?: { autopilot?: string };
}

/** Claims the case for the autopilot; false when another run has it or it isn't ready. */
export async function claimAutopilot(db: Firestore, studyId: string): Promise<AutopilotStudy | null> {
  const ref = db.collection("studies").doc(studyId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const study = snap.data() as AutopilotStudy | undefined;
    if (!study || study.status !== "ready" || study.demo?.autopilot !== "share") return null;
    tx.update(ref, { "demo.autopilot": "running" });
    return study;
  });
}

/** Review (accept all), sign, write the patient note, confirm its steps and share a PDF with consent. */
export async function runAutopilot(
  db: Firestore,
  bucket: Bucket,
  studyId: string,
  study: AutopilotStudy,
  deps: { rewrite?: Rewriter; sign?: ShareDeps["sign"] } = {},
): Promise<void> {
  const ref = db.collection("studies").doc(studyId);
  const uid = study.clinicianUid;
  const findings = (study.findings ?? []).map((f) => ({ ...f, status: "accepted", reviewedAt: Timestamp.now() }));
  const hash = reviewHash(findings as Parameters<typeof reviewHash>[0]);
  // Accepting every drafted finding leaves the drafted summary as it was.
  await ref.update({
    findings,
    reviewHash: hash,
    ...(study.clinicianSummary ? { "clinicianSummary.generatedFromReviewHash": hash } : {}),
  });
  // B14: a read the gate requires is assigned and signed straight away for the seeded case.
  if (readNeed((await ref.get()).data() ?? {})) {
    await assignRead(db, ref, { actor: "coordinator", now: Date.now(), requestedBy: uid, reader: DEFAULT_ROSTER[0] });
    await stepRead(db, ref, Date.now(), "sign");
  }
  await signStudyCore(db, uid, { studyId, confirmImpression: true, device: "demo autopilot" });
  await generatePatientSummaryCore(db, uid, { studyId }, deps.rewrite);
  const after = (await ref.get()).data() as AutopilotStudy;
  const ps = after.patientSummary;
  if (ps?.nextSteps) {
    await ref.update({ "patientSummary.nextSteps": ps.nextSteps.map((s) => ({ ...s, confirmed: true })) });
  }
  await shareStudyCore({ db, bucket, sign: deps.sign }, uid, { studyId, channel: "pdf", consent: true, consentNote: "Agreed at the visit (seeded demo case)." });
  await ref.update({ "demo.autopilot": "done" });
}
