/**
 * B9 · SAM 3.1 segmentation as a tool: one call for all labels, the best
 * detection per label, masks cached in Storage so later stages reuse them.
 *
 * Images go only to our own GPU service (models/gpu.ts). Masks are stored
 * as run-length JSON next to the study; only metadata goes on the study
 * document (the caller writes it through StudyWriter).
 */
import { getStorage } from "firebase-admin/storage";

import { decodeRle, samSegment, type Detection, type SegmentResponse } from "../models/gpu";
import type { PipelineStatus } from "../pipeline/errors";
import { ANATOMY, maskIdFor, type AnatomyLabel } from "./anatomy";
import { traceEvent } from "../lib/trace";
import { describeBox } from "../lib/traceText";

/** What the study document keeps about a mask. Box is [x0, y0, x1, y1], 0-1. */
export interface MaskRecord {
  label: AnatomyLabel;
  maskId: string;
  score: number;
  box: [number, number, number, number];
  areaPx: number;
  width: number;
  height: number;
  /** Storage path of the run-length mask JSON. */
  path: string;
}

export interface SegmentContext {
  bucket: string;
  /** `studies/{orgId}/{uid}/{studyId}` (older studies: `studies/{orgId}/{studyId}`) */
  studyPrefix: string;
  /** The model copy of the image (the same pixels SAM sees). */
  image: Buffer;
  step: PipelineStatus;
  /** Masks already on the study; their labels are not segmented again. */
  cached?: MaskRecord[];
  /** Where the mask JSON goes; default Cloud Storage. The eval runner keeps masks in memory. */
  saveMask?: MaskSaver;
}

export type MaskSaver = (path: string, json: string) => Promise<void>;

export interface SegmentResult {
  masks: MaskRecord[];
  /** Labels SAM did not find above their threshold. */
  missing: AnatomyLabel[];
  /** Labels served from the cache without a SAM call. */
  fromCache: AnatomyLabel[];
}

export type Segmenter = (image: Buffer, prompts: string[], step: PipelineStatus, threshold: number) => Promise<SegmentResponse>;

/** Pure: the highest-scoring detection per label that clears its threshold. */
export function pickBest(detections: Detection[], labels: AnatomyLabel[]): Map<AnatomyLabel, Detection> {
  const best = new Map<AnatomyLabel, Detection>();
  for (const label of labels) {
    const cfg = ANATOMY[label];
    for (const d of detections) {
      if (d.prompt !== cfg.prompt || d.score < cfg.threshold) continue;
      const current = best.get(label);
      if (!current || d.score > current.score) best.set(label, d);
    }
  }
  return best;
}

export async function segmentRegions(
  ctx: SegmentContext,
  labels: AnatomyLabel[],
  segment: Segmenter = samSegment,
): Promise<SegmentResult> {
  const cached = new Map((ctx.cached ?? []).map((m) => [m.label, m]));
  const fromCache = labels.filter((l) => cached.has(l));
  const todo = labels.filter((l) => !cached.has(l));
  const masks: MaskRecord[] = fromCache.map((l) => cached.get(l)!);
  const missing: AnatomyLabel[] = [];

  if (todo.length) {
    // One call for every label; send the lowest threshold, filter per label here.
    const threshold = Math.min(...todo.map((l) => ANATOMY[l].threshold));
    const started = Date.now();
    const res = await segment(ctx.image, todo.map((l) => ANATOMY[l].prompt), ctx.step, threshold);
    const samMs = Date.now() - started;
    const best = pickBest(res.detections, todo);
    // B19 trace: one row per label from this SAM call (latency on the first).
    todo.forEach((label, i) => {
      const d = best.get(label);
      traceEvent({
        kind: "tool",
        name: "segment_region",
        model: "sam-3.1",
        args: { label, prompt: ANATOMY[label].prompt },
        ms: i === 0 ? samMs : undefined,
        ok: !!d,
        result: d ? describeBox(d.box as [number, number, number, number], d.score) : `not found above score ${ANATOMY[label].threshold}`,
      });
    });
    const save: MaskSaver =
      ctx.saveMask ??
      (async (path, json) => {
        await getStorage().bucket(ctx.bucket).file(path).save(json, {
          contentType: "application/json",
          resumable: false,
          metadata: { cacheControl: "private, max-age=0" },
        });
      });
    for (const label of todo) {
      const d = best.get(label);
      if (!d) {
        missing.push(label);
        continue;
      }
      const maskId = maskIdFor(label);
      const path = `${ctx.studyPrefix}/masks/${maskId}.json`;
      const record: MaskRecord = {
        label,
        maskId,
        score: d.score,
        box: d.box as [number, number, number, number],
        areaPx: d.area_px,
        width: res.width,
        height: res.height,
        path,
      };
      await save(path, JSON.stringify({ ...record, rle: d.rle }));
      masks.push(record);
    }
  }
  return { masks, missing, fromCache };
}

/** Load a cached mask as a 0/1 array of `height * width` (row-major). */
export async function loadMask(bucketName: string, record: MaskRecord): Promise<Uint8Array> {
  const [buf] = await getStorage().bucket(bucketName).file(record.path).download();
  const { rle, width, height } = JSON.parse(buf.toString("utf8")) as { rle: number[]; width: number; height: number };
  return decodeRle(rle, height, width);
}

/**
 * Pure: is this a chest X-ray? Both lungs found on the expected sides
 * (radiological convention: the patient's left lung is on the image's
 * right) and not the same region twice. No model call.
 */
export function confirmStudyType(masks: MaskRecord[]): { chestXray: boolean; reason: string } {
  const left = masks.find((m) => m.label === "left lung");
  const right = masks.find((m) => m.label === "right lung");
  if (!left || !right) return { chestXray: false, reason: "lungs_not_found" };
  if (left.score < ANATOMY["left lung"].threshold || right.score < ANATOMY["right lung"].threshold) {
    return { chestXray: false, reason: "low_score" };
  }
  const cx = (b: number[]) => (b[0] + b[2]) / 2;
  if (!(cx(left.box) > cx(right.box))) return { chestXray: false, reason: "sides_swapped" };
  if (iou(left.box, right.box) > 0.3) return { chestXray: false, reason: "same_region" };
  return { chestXray: true, reason: "ok" };
}

export function iou(a: readonly number[], b: readonly number[]): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const area = (r: readonly number[]) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}
