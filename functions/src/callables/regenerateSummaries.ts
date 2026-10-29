import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { MODEL_MOCK } from "../config";
import { gpuHealth } from "../models/gpu";
import { generateJson } from "../models/client";
import type { DraftFinding, DraftSummaries, Modality } from "../models/fixtures";
import { clinicianSummaryPrompt } from "../models/prompts";
import { wrongState } from "../lib/callableErrors";
import { reviewHash } from "../lib/reviewHash";
import { traceScope } from "../lib/trace";
import { resolveHighlights } from "../pipeline/convert";
import { PipelineError } from "../pipeline/errors";
import { ClinicianSummarySchema } from "../schemas/study";
import { WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import { callerOf, canAct } from "../lib/access";

/** Summaries can be regenerated while the clinician is still reviewing, never after signing. */
const REGENERATE_IN: readonly StudyStatus[] = ["ready", "clinician_review"];

/**
 * Kept for older app builds. Since B16 the patient summary is written only
 * after signing (generatePatientSummary), so "patient" does nothing here and
 * "both" means the clinician summary.
 */
export type Which = "clinician" | "patient" | "both";

export interface RegenerateRequest {
  studyId: string;
  which?: Which;
}

export interface RegenerateResponse {
  reviewHash: string;
  clinicianSummary: DraftSummaries["clinicianSummary"] | null;
  /** The private GPU was cold: the background draft (B23) waits for it and writes the report. */
  queued?: "gpu_starting";
}

export interface StudyDoc {
  clinicianUid: string;
  clinicianName?: string;
  status: StudyStatus;
  modality: Modality;
  studyType?: string;
  clinicalContext?: string;
  findings?: DraftFinding[];
  clinicianSummary?: DraftSummaries["clinicianSummary"] | null;
}

/** The finding as the clinician left it: edited wording wins over the draft. */
function reviewedText(f: DraftFinding & { editedText?: string }): { title: string; description: string } {
  const edited = (f.editedText ?? "").trim();
  return { title: f.title, description: edited || f.description };
}

/**
 * The clinician summary drafted from the findings the clinician accepted or
 * edited, stamped with the review hash it was drafted from. Text-only (no
 * image): the review already captured what matters. Shared by the callable
 * and the background drafter (B23, triggers/draftReport.ts).
 */
export async function draftClinicianSummary(study: StudyDoc): Promise<{ hash: string; clinicianSummary: NonNullable<DraftSummaries["clinicianSummary"]> }> {
  const findings = (study.findings ?? []) as (DraftFinding & { editedText?: string })[];
  const included = findings.filter((f) => f.status === "accepted" || f.status === "edited");
  const hash = reviewHash(findings);
  const studyType = study.studyType || "study";
  const clinicalContext = (study.clinicalContext ?? "").trim();
  if (MODEL_MOCK) {
    const text = included.length ? included.map((f) => reviewedText(f).title).join(". ") + "." : "No findings were accepted for this study.";
    return {
      hash,
      clinicianSummary: {
        findings: text,
        impression: included.length ? included.map((f) => reviewedText(f).title) : ["No reportable findings."],
        recommendation: "Interpret alongside the full clinical picture.",
        highlights: resolveHighlights(text, included, included.map((f) => ({ findingIndex: f.index, quote: f.title }))),
        generatedFromReviewHash: hash,
        editedByClinician: false,
      },
    };
  }
  const draft = await generateJson({
    route: "clinical",
    schema: ClinicianSummarySchema,
    prompt: clinicianSummaryPrompt(studyType, study.modality, included.map(reviewedText), clinicalContext),
    step: "summarizing",
    answerTokens: 3072,
    reasoningEffort: "medium",
  });
  const text = draft.findings.trim();
  return {
    hash,
    clinicianSummary: {
      findings: text,
      impression: draft.impression.map((s) => s.trim()).filter(Boolean),
      recommendation: draft.recommendation.trim(),
      highlights: resolveHighlights(
        text,
        included,
        draft.highlights.map((h) => ({ findingIndex: included[h.findingIndex]?.index ?? -1, quote: h.quote })),
      ),
      generatedFromReviewHash: hash,
      editedByClinician: false,
    },
  };
}

export const regenerateSummaries = onCall<RegenerateRequest, Promise<RegenerateResponse>>(
  { enforceAppCheck: false, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const studyId = request.data?.studyId;
    const which: Which = request.data?.which ?? "both";
    if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");

    const db = getFirestore();
    const ref = db.collection("studies").doc(studyId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
    const study = snap.data() as StudyDoc;
    const caller = callerOf(request.auth);
    if (!canAct(study as { clinicianUid?: string; orgId?: string; source?: string }, caller.uid, caller.orgId)) throw new HttpsError("permission-denied", "Not your study.");
    if (!REGENERATE_IN.includes(study.status)) throw new HttpsError("failed-precondition", "The study is still being analyzed.");

    let hash = reviewHash(study.findings ?? []);
    let clinicianSummary = study.clinicianSummary ?? null;

    // A cold GPU would only time out here (90 s) while it takes ~5 min to
    // start. Hand the redraft to the background drafter, which waits for it.
    const gpu = which !== "patient" && !MODEL_MOCK ? (await gpuHealth(5_000)).glimmer : "ok";
    if (gpu !== "ok" && gpu !== "not_configured") {
      // Already being drafted for these decisions: don't start a second one.
      const inFlight = (study as { reportDraft?: { forHash?: string | null } }).reportDraft?.forHash === hash;
      if (!inFlight) await ref.update({ reportDraft: { forHash: null, requestedAt: new Date() } });
      logger.info("regenerateSummaries: queued until the GPU is up", { studyId });
      return { reviewHash: hash, clinicianSummary, queued: "gpu_starting" as const };
    }

    try {
      if (which !== "patient") ({ hash, clinicianSummary } = await traceScope(ref, "summarizing", () => draftClinicianSummary(study)));
    } catch (error) {
      const code = error instanceof PipelineError ? error.code : "internal";
      logger.error("regenerateSummaries failed", { studyId, which, code });
      throw new HttpsError(
        code === "timeout" ? "deadline-exceeded" : code === "model_refused" ? "failed-precondition" : "internal",
        code === "model_refused"
          ? "The model declined to summarise this review."
          : "Couldn't regenerate the summaries. Please try again.",
      );
    }

    try {
      await new StudyWriter(ref, { uid: request.auth.uid }).patch(
        which !== "patient" ? { clinicianSummary } : {},
        { allowedIn: REGENERATE_IN, action: `summaries_regenerated_${which}` },
      );
    } catch (error) {
      if (error instanceof WrongStateError) throw wrongState(error, "This study can no longer be changed.");
      throw error;
    }
    logger.info("regenerateSummaries: done", { studyId, which });
    return { reviewHash: hash, clinicianSummary };
  },
);
