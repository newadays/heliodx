/**
 * B11 · Intake stage: is the image readable, what is it, and (for X-rays)
 * are the lungs where a chest X-ray puts them. Same inputs and outputs an
 * agent tool would have (B5 can wrap it later).
 *
 * Retake when the model says so, the image is not medical, or the
 * resolution is objectively too low. Other code quality issues inform the
 * model rather than overrule it: the limits come from one calibration film.
 */
import { logger } from "firebase-functions/v2";

import { generateJson } from "../models/client";
import { intakePrompt } from "../models/prompts";
import type { Modality } from "../models/fixtures";
import type { PipelineStatus } from "../pipeline/errors";
import { IntakeSchema } from "../schemas/study";
import { CHEST_LABELS } from "../tools/anatomy";
import { measureQuality, qualityIssues, qualityScore, type QualityMetrics } from "../tools/quality";
import { confirmStudyType, segmentRegions, type MaskRecord, type Segmenter } from "../tools/segment";

export interface IntakeInput {
  /** The model copy of the image (what SAM and Glimmer see). */
  image: Buffer;
  modalityHint: Modality;
  clinicalContext: string;
  bucket: string;
  studyPrefix: string;
  step: PipelineStatus;
}

export interface IntakeDeps {
  generate?: typeof generateJson;
  segment?: Segmenter;
}

export interface IntakeOutput {
  retake: boolean;
  quality: { ok: boolean; score: number; issues: string[] };
  metrics: QualityMetrics;
  modality: Modality;
  studyType: string;
  view: "PA" | "AP" | "lateral" | "other" | "unknown";
  /** Lungs found on the radiological sides. */
  chest: boolean;
  masks: MaskRecord[];
  /** SAM failed; the study continues without masks (flags.degraded). */
  samError: string | null;
}

const LOW_RES = "Image resolution is too low.";

export async function runIntake(input: IntakeInput, deps: IntakeDeps = {}): Promise<IntakeOutput> {
  const generate = deps.generate ?? generateJson;
  const metrics = await measureQuality(input.image);
  const codeIssues = qualityIssues(metrics);

  const draft = await generate({
    route: "clinical",
    schema: IntakeSchema,
    prompt: intakePrompt(input.modalityHint, input.clinicalContext, metrics, codeIssues),
    image: { mimeType: "image/jpeg", data: input.image },
    step: input.step,
    answerTokens: 1024,
  });

  // A non-medical image is the reason that matters most, so it always leads.
  const lead = draft.looksMedical ? [] : ["This does not look like a medical image."];
  const issues = [...new Set([...lead, ...codeIssues, ...draft.quality.issues])].slice(0, 6);
  const retake = draft.decision === "retake" || !draft.looksMedical || codeIssues.includes(LOW_RES);

  let masks: MaskRecord[] = [];
  let chest = false;
  let samError: string | null = null;
  if (!retake && draft.modality === "xray") {
    try {
      const seg = await segmentRegions(
        { bucket: input.bucket, studyPrefix: input.studyPrefix, image: input.image, step: input.step },
        CHEST_LABELS,
        deps.segment,
      );
      masks = seg.masks;
      chest = confirmStudyType(masks).chestXray;
    } catch (error) {
      // Continue without masks; triage marks the draft degraded.
      samError = error instanceof Error ? error.message.slice(0, 200) : String(error);
      logger.warn("intake: SAM failed, continuing without masks", { step: input.step });
    }
  }

  const view = draft.view;
  const studyType = chest ? (view === "PA" || view === "AP" ? `Chest X-ray (${view})` : "Chest X-ray") : draft.studyType;
  return {
    retake,
    quality: { ok: !retake, score: qualityScore(metrics), issues },
    metrics,
    modality: draft.modality,
    studyType,
    view,
    chest,
    masks,
    samError,
  };
}
