/**
 * B12 · Prep stage: evidence-backed observations for chest X-rays.
 *
 * One Glimmer call (image + an evidence catalogue of measurement and region
 * ids) proposes observations that must each cite evidence. Code then:
 * keeps only real ids (an observation with none left is dropped), drops
 * observations that assert a condition, sets strength from the evidence
 * (lib/strength.ts), places each region on a SAM mask or the measured heart
 * region, and points to its overlay. Same inputs/outputs an agent tool would
 * have (B5 can wrap it).
 */
import { logger } from "firebase-functions/v2";

import { findingColor } from "../lib/colors";
import { confidenceFor, strengthOf, thresholdFor, type Strength } from "../lib/strength";
import { assertsCondition, stripConditionSentences } from "../lib/vocabulary";
import { generateJson } from "../models/client";
import type { DraftFinding, DraftSummaries } from "../models/fixtures";
import { prepPrompt } from "../models/prompts";
import { resolveHighlights } from "../pipeline/convert";
import { PipelineError, type PipelineStatus } from "../pipeline/errors";
import { PrepSchema } from "../schemas/study";
import type { Measurement, MeasurementFlag } from "../tools/measure";
import { saveOverlay } from "../tools/overlay";
import type { MaskRecord } from "../tools/segment";

export const HEART_REGION = "heart-region";

const ABOUT: Record<Measurement["id"], string> = {
  cardiothoracic_ratio: "cardiothoracic ratio from the lung borders",
  lung_area_asymmetry: "difference in lung area, as a fraction of the larger lung",
  cp_blunting_left: "left costophrenic angle blunting, 0 sharp to 1 blunted",
  cp_blunting_right: "right costophrenic angle blunting, 0 sharp to 1 blunted",
  density_ratio: "mean brightness of the left lung over the right",
};

export interface EvidencedFinding extends DraftFinding {
  strength: Strength;
  evidence: { measurementIds: string[]; maskIds: string[] };
  overlayPath: string | null;
}

export interface PrepInput {
  image: Buffer;
  studyType: string;
  clinicalContext: string;
  masks: MaskRecord[];
  measurements: Measurement[];
  flags: MeasurementFlag[];
  heartBox: [number, number, number, number] | null;
  overlays: Record<string, string>;
  bucket: string;
  studyPrefix: string;
  step: PipelineStatus;
}

export interface PrepDeps {
  generate?: typeof generateJson;
  saveOverlay?: typeof saveOverlay;
}

export interface PrepOutput {
  findings: EvidencedFinding[];
  clinicianSummary: DraftSummaries["clinicianSummary"];
  /** Observations removed by the condition filter or for lacking real evidence. */
  dropped: { conditions: number; noEvidence: number };
}

export async function runPrep(input: PrepInput, deps: PrepDeps = {}): Promise<PrepOutput> {
  const generate = deps.generate ?? generateJson;
  const overlay = deps.saveOverlay ?? saveOverlay;
  const flagged = new Set(input.flags.map((f) => f.measurementId));

  const evidence = [
    ...input.measurements.map((m) => ({
      id: m.id,
      about: `${ABOUT[m.id]} = ${m.value} (threshold ${thresholdFor(m.id)}${flagged.has(m.id) ? ", crossed" : ", within"})`,
    })),
    ...input.masks.map((m) => ({ id: m.maskId, about: `${m.label} outline from segmentation (score ${m.score})` })),
  ];
  const regions = [
    ...input.masks.map((m) => ({ id: m.maskId, about: m.label })),
    ...(input.heartBox ? [{ id: HEART_REGION, about: "the cardiac silhouette between the lungs" }] : []),
  ];

  const draft = await generate({
    route: "clinical",
    schema: PrepSchema,
    prompt: prepPrompt(input.studyType, input.clinicalContext, evidence, regions),
    image: { mimeType: "image/jpeg", data: input.image },
    step: input.step,
    answerTokens: 2048,
    reasoningEffort: "medium",
  });

  const byMeasure = new Map(input.measurements.map((m) => [m.id as string, m]));
  const byMask = new Map(input.masks.map((m) => [m.maskId, m]));
  const dropped = { conditions: 0, noEvidence: 0 };
  // The model's index for each kept observation, for the summary highlights.
  const kept: { modelIndex: number; regionId: string | null; finding: EvidencedFinding }[] = [];

  for (const [modelIndex, p] of draft.proposed.entries()) {
    if (assertsCondition(`${p.title} ${p.description}`)) {
      dropped.conditions++;
      continue;
    }
    const ids = [...new Set(p.evidence.map((e) => e.trim()))];
    const measurementIds = ids.filter((id) => byMeasure.has(id));
    const maskIds = ids.filter((id) => byMask.has(id));
    if (!measurementIds.length && !maskIds.length) {
      dropped.noEvidence++;
      continue;
    }
    const strength = strengthOf(
      measurementIds.map((id) => byMeasure.get(id)!),
      maskIds.map((id) => byMask.get(id)!.score),
    );
    const regionId = pickRegion(p.region.trim(), measurementIds, maskIds, byMask, !!input.heartBox);
    const index = kept.length;
    kept.push({
      modelIndex,
      regionId,
      finding: {
        id: `f${index + 1}`,
        index,
        title: p.title.trim(),
        description: p.description.trim(),
        confidence: confidenceFor(strength),
        region: regionFor(regionId, byMask, input.heartBox),
        color: findingColor(index),
        status: "pending",
        reviewedAt: null,
        strength,
        evidence: { measurementIds, maskIds },
        overlayPath: null,
      },
    });
  }

  // Overlays: lungs were rendered in triage; the heart region on first use.
  let heartOverlay: string | null = null;
  for (const { finding, regionId } of kept) {
    if (regionId && input.overlays[regionId]) finding.overlayPath = input.overlays[regionId];
    if (regionId === HEART_REGION && input.heartBox && input.masks[0]) {
      heartOverlay ??= await saveHeartOverlay(input, overlay);
      finding.overlayPath = heartOverlay;
    }
  }

  const findings = kept.map((k) => k.finding);
  if (!findings.length) {
    // An empty draft would read as a normal film; fail visibly instead.
    throw new PipelineError("schema_invalid", "No observation cited real evidence.", input.step);
  }
  const text = stripConditionSentences(draft.clinicianSummary.findings.trim());
  const indexMap = new Map(kept.map((k) => [k.modelIndex, k.finding.index]));
  const clinicianSummary: DraftSummaries["clinicianSummary"] = {
    findings: text,
    impression: draft.clinicianSummary.impression.map((s) => s.trim()).filter((s) => s && !assertsCondition(s)),
    recommendation: stripConditionSentences(draft.clinicianSummary.recommendation.trim()),
    highlights: resolveHighlights(
      text,
      findings,
      draft.clinicianSummary.highlights
        .filter((h) => indexMap.has(h.findingIndex))
        .map((h) => ({ findingIndex: indexMap.get(h.findingIndex)!, quote: h.quote })),
    ),
    generatedFromReviewHash: null,
    editedByClinician: false,
  };
  if (!clinicianSummary.impression.length) clinicianSummary.impression = ["See the observations above."];
  if (dropped.conditions || dropped.noEvidence) logger.info("prep: observations dropped", { step: input.step, ...dropped });
  return { findings, clinicianSummary, dropped };
}

/** Region: the model's choice if it names a real region, else derived from the evidence. */
export function pickRegion(
  requested: string,
  measurementIds: string[],
  maskIds: string[],
  byMask: Map<string, MaskRecord>,
  hasHeart: boolean,
): string | null {
  if (byMask.has(requested)) return requested;
  if (requested === HEART_REGION && hasHeart) return HEART_REGION;
  if (measurementIds.includes("cardiothoracic_ratio") && hasHeart) return HEART_REGION;
  if (measurementIds.includes("cp_blunting_left")) return [...byMask.values()].find((m) => m.label === "left lung")?.maskId ?? null;
  if (measurementIds.includes("cp_blunting_right")) return [...byMask.values()].find((m) => m.label === "right lung")?.maskId ?? null;
  if (maskIds.length === 1) return maskIds[0];
  return null;
}

function regionFor(
  regionId: string | null,
  byMask: Map<string, MaskRecord>,
  heartBox: PrepInput["heartBox"],
): DraftFinding["region"] {
  const box = regionId === HEART_REGION ? heartBox : regionId ? byMask.get(regionId)?.box : null;
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { shape: "ellipse", x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
}

/** An ellipse over the measured heart region, at the mask resolution. */
async function saveHeartOverlay(input: PrepInput, overlay: typeof saveOverlay): Promise<string> {
  const ref = input.masks[0];
  const { width: w, height: h } = ref;
  const [x0, y0, x1, y1] = input.heartBox!;
  const cx = ((x0 + x1) / 2) * w;
  const cy = ((y0 + y1) / 2) * h;
  const rx = Math.max(1, ((x1 - x0) / 2) * w);
  const ry = Math.max(1, ((y1 - y0) / 2) * h);
  const mask = new Uint8Array(w * h);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (y < 0 || y >= h) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || x >= w) continue;
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) mask[y * w + x] = 1;
    }
  }
  const record: MaskRecord = { ...ref, label: ref.label, maskId: HEART_REGION, box: input.heartBox!, path: "" };
  return overlay(input.bucket, input.studyPrefix, record, mask, "#F5B400");
}
