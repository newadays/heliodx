/**
 * B11 · Intake stage: is the image readable, what is it, and (for X-rays)
 * are the lungs where a chest X-ray puts them. Same inputs and outputs an
 * agent tool would have (B5 can wrap it later).
 *
 * A study stops only for what can be measured or is unambiguous: the
 * resolution is too low, the film is blurred, or the model says it is not a
 * medical image at all. Everything else the model or the code notices (glare,
 * exposure, contrast, a model "retake") is a warning the clinician sees in
 * Review: on 29 Oct Glimmer called a clean digital AP film "a photograph with
 * glare" and the study stopped. The exposure limits come from one film.
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
  /** `issues` stop the study; `warnings` are shown to the clinician and analysis continues. */
  quality: { ok: boolean; score: number; issues: string[]; warnings: string[] };
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
const BLURRED = "Image looks blurred.";
const NOT_MEDICAL = "This does not look like a medical image.";

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
  const blocking = [...(draft.looksMedical ? [] : [NOT_MEDICAL]), ...codeIssues.filter((i) => i === LOW_RES || i === BLURRED)];
  const issues = draft.looksMedical ? blocking : [...new Set([...blocking, ...draft.quality.issues])].slice(0, 6);
  const warnings = [...new Set([...codeIssues.filter((i) => !blocking.includes(i)), ...(draft.looksMedical ? draft.quality.issues : [])])].slice(0, 6);
  const retake = blocking.length > 0;
  if (draft.decision === "retake" && !retake) logger.info("intake: model suggested a retake; shown as a warning", { step: input.step, warnings: warnings.length });

  let masks: MaskRecord[] = [];
  let chest = false;
  let samError: string | null = null;
  if (draft.looksMedical && draft.modality === "xray") {
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
    quality: { ok: !retake, score: qualityScore(metrics), issues, warnings },
    metrics,
    modality: draft.modality,
    studyType,
    view,
    chest,
    masks,
    samError,
  };
}
