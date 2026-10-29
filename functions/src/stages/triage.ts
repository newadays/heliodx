/**
 * B11 · Triage stage: measurements from the lung masks, thresholds crossed,
 * a priority floor set in code, overlays for the app, and one text-only
 * Glimmer call that may raise the priority (never lower it) and must cite
 * real measurement or mask ids.
 *
 * Failure rules: SAM already failed at intake -> degraded, low confidence.
 * The triage model call fails for a non-transient reason -> priority at
 * least urgent and needsHuman. A transient failure (model service down)
 * propagates so the study is requeued.
 */
import { logger } from "firebase-functions/v2";
import sharp from "sharp";

import { generateJson } from "../models/client";
import { triagePrompt } from "../models/prompts";
import { PipelineError, type PipelineStatus } from "../pipeline/errors";
import { isTransient } from "../pipeline/retryPolicy";
import { TriageSchema } from "../schemas/study";
import { ANATOMY } from "../tools/anatomy";
import { evaluateMeasurements, measureChest, type ChestMeasurements, type Measurement, type MeasurementFlag } from "../tools/measure";
import { saveOverlay } from "../tools/overlay";
import { loadMask, type MaskRecord } from "../tools/segment";
import { maxPriority, priorityFloor, validEvidence, type Priority } from "./priority";

export interface TriageInput {
  image: Buffer;
  masks: MaskRecord[];
  chest: boolean;
  samError: string | null;
  studyType: string;
  view: string;
  bucket: string;
  studyPrefix: string;
  step: PipelineStatus;
}

export interface TriageDeps {
  generate?: typeof generateJson;
  loadMask?: typeof loadMask;
  saveOverlay?: typeof saveOverlay;
}

export interface TriageOutput {
  priority: Priority;
  floor: Priority;
  evidence: string[];
  rationale: string;
  confidence: "low" | "medium" | "high";
  measurements: Measurement[];
  flags: MeasurementFlag[];
  heartBox: [number, number, number, number] | null;
  /** The CTR widths for the viewer (B21); null when not measured. */
  ctrLines: ChestMeasurements["ctrLines"];
  /** maskId -> Storage path of its overlay PNG. */
  overlays: Record<string, string>;
  degraded: boolean;
  needsHuman: boolean;
}

export async function runTriage(input: TriageInput, deps: TriageDeps = {}): Promise<TriageOutput> {
  const generate = deps.generate ?? generateJson;
  const load = deps.loadMask ?? loadMask;
  const overlay = deps.saveOverlay ?? saveOverlay;

  let measurements: Measurement[] = [];
  let heartBox: TriageOutput["heartBox"] = null;
  let ctrLines: TriageOutput["ctrLines"] = null;
  const overlays: Record<string, string> = {};
  const left = input.masks.find((m) => m.label === "left lung");
  const right = input.masks.find((m) => m.label === "right lung");

  if (input.chest && left && right) {
    const [lm, rm] = await Promise.all([load(input.bucket, left), load(input.bucket, right)]);
    // Greyscale at the mask size (SAM saw the same image, so sizes match).
    const { data: grey } = await sharp(input.image)
      .greyscale()
      .resize(left.width, left.height, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const chest = measureChest({
      left: lm,
      right: rm,
      grey,
      width: left.width,
      height: left.height,
      leftMaskId: left.maskId,
      rightMaskId: right.maskId,
    });
    measurements = chest.measurements;
    heartBox = chest.heartBox;
    ctrLines = chest.ctrLines;
    for (const [rec, mask] of [[left, lm], [right, rm]] as const) {
      overlays[rec.maskId] = await overlay(input.bucket, input.studyPrefix, rec, mask, ANATOMY[rec.label].color);
    }
  }

  const view = input.view === "PA" || input.view === "AP" || input.view === "lateral" ? input.view : "unknown";
  const flags = evaluateMeasurements(measurements, view);
  const floor = priorityFloor(flags);
  const degraded = !!input.samError;
  const allowed = [...measurements.map((m) => m.id), ...input.masks.map((m) => m.maskId)];

  try {
    const draft = await generate({
      route: "clinical",
      schema: TriageSchema,
      prompt: triagePrompt(input.studyType, input.view, measurements, flags, floor, input.masks.map((m) => m.maskId)),
      step: input.step,
      answerTokens: 512,
    });
    const priority = maxPriority(floor, draft.priority);
    // Confidence from what was measured, not from the model.
    const confidence = degraded || measurements.length === 0 ? "low" : flags.length ? "medium" : "high";
    return {
      priority,
      floor,
      evidence: validEvidence(draft.evidence, allowed),
      rationale: draft.rationale.trim(),
      confidence,
      measurements,
      flags,
      heartBox,
      ctrLines,
      overlays,
      degraded,
      needsHuman: false,
    };
  } catch (error) {
    if (error instanceof PipelineError && isTransient(error.code)) throw error;
    logger.warn("triage: model call failed, escalating for human review", {
      step: input.step,
      code: error instanceof PipelineError ? error.code : "internal",
    });
    return {
      priority: maxPriority(floor, "urgent"),
      floor,
      evidence: flags.map((f) => f.measurementId),
      rationale: "Automatic triage was unavailable; a person should review this study.",
      confidence: "low",
      measurements,
      flags,
      heartBox,
      ctrLines,
      overlays,
      degraded,
      needsHuman: true,
    };
  }
}
