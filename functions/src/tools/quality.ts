/**
 * B10 · Image quality in code (sharp): numbers only, no pixels to a model.
 * Computed on a greyscale copy scaled to QUALITY_PX on the long edge, so the
 * blur measure means the same thing whatever the original resolution.
 */
import sharp from "sharp";

import { QUALITY_LIMITS, QUALITY_PX } from "../schemas/thresholds";

export interface QualityMetrics {
  /** Variance of the Laplacian (higher = sharper). */
  sharpness: number;
  /** Mean brightness, 0-255. */
  mean: number;
  /** 1st and 99th brightness percentiles. */
  p1: number;
  p99: number;
  /** Fraction of pixels at either extreme. */
  clipped: number;
  /** Original size. */
  width: number;
  height: number;
}

export async function measureQuality(image: Buffer): Promise<QualityMetrics> {
  const meta = await sharp(image, { failOn: "none" }).metadata();
  const { data, info } = await sharp(image, { failOn: "none" })
    .rotate()
    .greyscale()
    .resize({ width: QUALITY_PX, height: QUALITY_PX, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { ...greyStats(data, info.width, info.height), width: meta.width ?? info.width, height: meta.height ?? info.height };
}

/** Pure: sharpness and exposure statistics of an 8-bit greyscale buffer. */
export function greyStats(px: Uint8Array, w: number, h: number): Omit<QualityMetrics, "width" | "height"> {
  const hist = new Array<number>(256).fill(0);
  let sum = 0;
  for (let i = 0; i < px.length; i++) {
    hist[px[i]]++;
    sum += px[i];
  }
  const n = px.length;
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= q * n) return v;
    }
    return 255;
  };
  let clippedCount = 0;
  for (let v = 0; v <= 3; v++) clippedCount += hist[v] + hist[255 - v];

  // 4-neighbour Laplacian over the interior.
  let lsum = 0;
  let lsq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = px[i - 1] + px[i + 1] + px[i - w] + px[i + w] - 4 * px[i];
      lsum += l;
      lsq += l * l;
      count++;
    }
  }
  const lmean = count ? lsum / count : 0;
  const sharpness = count ? lsq / count - lmean * lmean : 0;
  return { sharpness: round(sharpness), mean: round(sum / n), p1: pct(0.01), p99: pct(0.99), clipped: round(clippedCount / n, 4) };
}

/** Pure: issues against QUALITY_LIMITS (empty = readable). */
export function qualityIssues(m: QualityMetrics, limits = QUALITY_LIMITS): string[] {
  const issues: string[] = [];
  if (Math.max(m.width, m.height) < limits.minLongEdgePx) issues.push("Image resolution is too low.");
  if (m.sharpness < limits.minSharpness) issues.push("Image looks blurred.");
  if (m.clipped > limits.maxClipped || m.mean < limits.minMean || m.mean > limits.maxMean) {
    issues.push(m.mean < 128 ? "Image looks underexposed." : "Image looks overexposed.");
  }
  if (m.p99 - m.p1 < limits.minDynamicRange) issues.push("Image looks washed out (low contrast).");
  return issues;
}

/**
 * Pure: usability 0-100 from the metrics. Each check is scored against its
 * limit (sharpness at twice the limit counts as full marks), then averaged.
 */
export function qualityScore(m: QualityMetrics, limits = QUALITY_LIMITS): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const sharp = clamp(m.sharpness / (2 * limits.minSharpness));
  const range = clamp((m.p99 - m.p1) / (2 * limits.minDynamicRange));
  const exposure = m.mean < limits.minMean || m.mean > limits.maxMean ? 0 : clamp(1 - m.clipped / limits.maxClipped);
  const resolution = Math.max(m.width, m.height) >= limits.minLongEdgePx ? 1 : 0;
  return Math.round(((sharp + range + exposure + resolution) / 4) * 100);
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
