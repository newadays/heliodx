/**
 * B16 · Write the patient summary from the SIGNED report. Only the frozen
 * `study.report` text goes to the model (Glimmer on our own GPU, clinical
 * route), never the image or the draft. Code maps each "what happens next"
 * step to a signed Recommendation sentence, checks for added instructions and
 * unsigned condition names, measures reading level, retries once, and falls
 * back to the clinician's own words where the rewrite still fails
 * (lib/patientSummary.ts). The first summary moves the study
 * `signed → patient_summary_ready`; regenerating is allowed until it is shared.
 * No clinical text is logged.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { MODEL_MOCK } from "../config";
import { wrongState } from "../lib/callableErrors";
import {
  assemble,
  checkRewrite,
  recommendationSentences,
  retryFeedback,
  type PatientRewrite,
  type PatientSummary,
  type SignedText,
} from "../lib/patientSummary";
import { generateJson } from "../models/client";
import { patientSummaryFromSignedPrompt } from "../models/prompts";
import { PipelineError } from "../pipeline/errors";
import { PatientSummaryRewriteSchema } from "../schemas/study";
import { WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import { traceEvent, traceScope } from "../lib/trace";
import { asCaller, callerOf, canAct, type Caller } from "../lib/access";

export const PATIENT_SUMMARY_IN: readonly StudyStatus[] = ["signed", "patient_summary_ready"];

export interface GeneratePatientSummaryRequest {
  studyId: string;
}

export interface GeneratePatientSummaryResult {
  steps: number;
  flagged: number;
  readingGrade: number;
  attempts: number;
}

/** Rewrites the signed text; `feedback` names what the previous attempt broke. */
export type Rewriter = (signed: SignedText, sentences: string[], feedback: string) => Promise<PatientRewrite>;

/** Deterministic rewrite for the emulator (MODEL_MOCK): the signed sentences, framed simply. */
export const mockRewriter: Rewriter = async (signed, sentences) => ({
  body: `Your clinician has looked at your ${signed.studyType ? "scan" : "results"} and written this note for you.`,
  nextSteps: sentences.map((s) => s),
});

export const modelRewriter: Rewriter = async (signed, sentences, feedback) =>
  generateJson({
    route: "clinical",
    schema: PatientSummaryRewriteSchema,
    prompt: patientSummaryFromSignedPrompt(signed, sentences, feedback),
    step: "summarizing",
    temperature: 0.3,
    answerTokens: 1024,
  });

export async function generatePatientSummaryCore(
  db: Firestore,
  caller: Caller,
  req: GeneratePatientSummaryRequest,
  rewrite: Rewriter = MODEL_MOCK ? mockRewriter : modelRewriter,
): Promise<GeneratePatientSummaryResult> {
  const ref = db.collection("studies").doc(req.studyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
  const { uid, orgId } = asCaller(caller);
  if (!canAct(snap.data() ?? {}, uid, orgId)) throw new HttpsError("permission-denied", "Only the clinician who owns this study can do this.");
  const status = snap.get("status") as StudyStatus;
  if (!PATIENT_SUMMARY_IN.includes(status)) {
    throw new WrongStateError(status, PATIENT_SUMMARY_IN.map((s) => `status ${s}`));
  }
  const report = snap.get("report") as { studyType?: string; summary?: Partial<SignedText> } | undefined;
  const signature = snap.get("signed") as { by?: string; name?: string; reportHash?: string } | undefined;
  if (!report?.summary || !signature?.reportHash) {
    throw new HttpsError("failed-precondition", "Sign the report first.");
  }

  const signed: SignedText = {
    studyType: report.studyType ?? "",
    findings: report.summary.findings ?? "",
    impression: report.summary.impression ?? [],
    recommendation: report.summary.recommendation ?? "",
  };
  const sentences = recommendationSentences(signed.recommendation);
  const reportHash = signature.reportHash;
  const signer = (signature.name ?? "").trim();
  // §4.11: a sample's sign-off is always simulated; an upload's never is (it
  // carries the research-prototype wording instead, on the PDF).
  const source = snap.get("source") as string | undefined;
  const simulated =
    source === "sample" ? true : source === "upload" ? false : signature.by ? (await db.collection("users").doc(signature.by).get()).get("simulated") === true : false;

  return traceScope(ref, "patient_summary", async () => {
    const candidates: PatientRewrite[] = [await rewrite(signed, sentences, "")];
    const first = checkRewrite(candidates[0], sentences, signed.impression);
    traceEvent({
      kind: "check",
      name: "check_patient_summary",
      args: { attempt: 1, steps: sentences.length },
      ok: first.ok,
      result: first.ok ? `pass · grade ${first.grade}` : `retry · ${first.steps.filter((x) => x.added.length).length} step(s) add terms · ${first.bodyViolations.length} condition name(s) · grade ${first.grade}`,
    });
    if (!first.ok) candidates.push(await rewrite(signed, sentences, retryFeedback(first)));

    const { summary, flagged } = assemble({ signed, sentences, candidates, signer, simulated, reportHash });
    traceEvent({
      kind: "check",
      name: "map_next_steps",
      args: { steps: summary.nextSteps.length },
      ok: true,
      result: `${summary.nextSteps.length} step(s) mapped to signed sentences · ${flagged} from signed text · grade ${summary.readingGrade}`,
    });
    await save(db, uid, req.studyId, summary);
    return { steps: summary.nextSteps.length, flagged, readingGrade: summary.readingGrade, attempts: candidates.length };
  });
}

/** First summary advances to patient_summary_ready; later ones replace it. */
async function save(db: Firestore, uid: string, studyId: string, summary: PatientSummary): Promise<void> {
  const writer = new StudyWriter(db.collection("studies").doc(studyId), { uid });
  const action = "patient_summary_generated";
  try {
    await writer.advanceWith("patient_summary_ready", () => ({ patientSummary: summary }), { action });
  } catch (error) {
    if (!(error instanceof WrongStateError) || error.stage !== "patient_summary_ready") throw error;
    await writer.patch({ patientSummary: summary }, { allowedIn: ["patient_summary_ready"], action });
  }
}

export const generatePatientSummary = onCall<GeneratePatientSummaryRequest, Promise<GeneratePatientSummaryResult>>(
  { enforceAppCheck: false, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const studyId = request.data?.studyId;
    if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");
    try {
      const out = await generatePatientSummaryCore(getFirestore(), callerOf(request.auth), { studyId });
      logger.info("generatePatientSummary: done", { studyId, ...out });
      return out;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof WrongStateError) throw wrongState(error, "The patient summary can be written only after signing and before sharing.");
      const code = error instanceof PipelineError ? error.code : "internal";
      logger.error("generatePatientSummary failed", { studyId, code });
      throw new HttpsError(
        code === "timeout" || code === "model_unavailable" ? "unavailable" : "internal",
        "Couldn't write the patient summary. Please try again.",
      );
    }
  },
);
