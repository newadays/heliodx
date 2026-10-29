/**
 * B10 · Chest measurements from the two SAM lung masks and the greyscale
 * image. Pure functions over row-major 0/1 masks of width x height; no
 * model involved. Each measurement names the masks it rests on, so a finding
 * can cite it as evidence.
 *
 * SAM 3.1 does not segment the heart on X-rays (B9 probe), so the heart is
 * measured as the gap between the lungs' inner borders across the lower
 * chest, the usual way to get a cardiothoracic ratio from lung outlines.
 * Radiological convention: the patient's right lung is on the image's left.
 */
import { THRESHOLDS } from "../schemas/thresholds";

export type MeasurementId =
  | "cardiothoracic_ratio"
  | "lung_area_asymmetry"
  | "cp_blunting_left"
  | "cp_blunting_right"
  | "density_ratio";

export interface Measurement {
  id: MeasurementId;
  value: number;
  maskIds: string[];
}

export interface ChestInput {
  /** Patient's left lung (image right) and right lung (image left). */
  left: Uint8Array;
  right: Uint8Array;
  /** Greyscale pixels of the same image, same size as the masks. */
  grey: Uint8Array;
  width: number;
  height: number;
  leftMaskId: string;
  rightMaskId: string;
}

/** A horizontal span on the image, 0–1 of width/height. */
export interface Span {
  y: number;
  x0: number;
  x1: number;
}

export interface ChestMeasurements {
  measurements: Measurement[];
  /** Region between the lungs used for the heart width, [x0, y0, x1, y1] 0-1; null if not measurable. */
  heartBox: [number, number, number, number] | null;
  /** The two widths the cardiothoracic ratio divides (B21, drawn on the film); null if not measurable. */
  ctrLines: { heart: Span; thorax: Span } | null;
}

interface RowExtent {
  min: number;
  max: number;
}

function rowExtents(mask: Uint8Array, w: number, h: number): (RowExtent | null)[] {
  const rows: (RowExtent | null)[] = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    let min = -1;
    let max = -1;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[o + x]) {
        if (min < 0) min = x;
        max = x;
      }
    }
    if (min >= 0) rows[y] = { min, max };
  }
  return rows;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function measureChest(input: ChestInput): ChestMeasurements {
  const { left, right, grey, width: w, height: h } = input;
  const L = rowExtents(left, w, h);
  const R = rowExtents(right, w, h);
  const both = [input.leftMaskId, input.rightMaskId];
  const measurements: Measurement[] = [];

  // Vertical extent of the lung fields.
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    if (L[y] || R[y]) {
      if (top < 0) top = y;
      bottom = y;
    }
  }

  // Cardiothoracic ratio: widest gap between the inner borders, over the
  // widest outer span of both lungs. The gap is only measured on rows where
  // each lung is at least half its own maximum width: near the diaphragm the
  // lungs shrink to thin lateral slivers and the "gap" becomes the whole
  // chest (seen on the B10 live check: ratio 0.82 without this rule, 0.44
  // with it). Rows from 40% of the lung height down.
  let heartBox: ChestMeasurements["heartBox"] = null;
  let ctrLines: ChestMeasurements["ctrLines"] = null;
  if (top >= 0) {
    let thoracic = 0;
    let thoracicRow = -1;
    let maxWL = 0;
    let maxWR = 0;
    for (let y = top; y <= bottom; y++) {
      const l = L[y];
      const r = R[y];
      if (l) maxWL = Math.max(maxWL, l.max - l.min + 1);
      if (r) maxWR = Math.max(maxWR, r.max - r.min + 1);
      if (l && r && l.max - r.min + 1 > thoracic) {
        thoracic = l.max - r.min + 1;
        thoracicRow = y;
      }
    }
    const bandStart = Math.round(top + 0.4 * (bottom - top));
    const usable = (y: number) => {
      const l = L[y];
      const r = R[y];
      return !!l && !!r && l.max - l.min + 1 >= 0.5 * maxWL && r.max - r.min + 1 >= 0.5 * maxWR;
    };
    let heart = 0;
    let heartRow = -1;
    for (let y = bandStart; y <= bottom; y++) {
      if (!usable(y)) continue;
      const gap = L[y]!.min - R[y]!.max - 1;
      if (gap > heart) {
        heart = gap;
        heartRow = y;
      }
    }
    if (thoracic > 0 && heart > 0) {
      measurements.push({ id: "cardiothoracic_ratio", value: r4(heart / thoracic), maskIds: both });
      // Vertical extent: usable rows whose gap is within 60% of the widest.
      let y0 = heartRow;
      let y1 = heartRow;
      for (let y = bandStart; y <= bottom; y++) {
        if (!usable(y)) continue;
        if (L[y]!.min - R[y]!.max - 1 >= 0.6 * heart) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
      const r = R[heartRow]!;
      const l = L[heartRow]!;
      heartBox = [r4((r.max + 1) / w), r4(y0 / h), r4(l.min / w), r4((y1 + 1) / h)];
      const tl = L[thoracicRow]!;
      const tr = R[thoracicRow]!;
      ctrLines = {
        heart: { y: r4(heartRow / h), x0: r4((r.max + 1) / w), x1: r4(l.min / w) },
        thorax: { y: r4(thoracicRow / h), x0: r4(tr.min / w), x1: r4((tl.max + 1) / w) },
      };
    }
  }

  // Lung area asymmetry.
  let aL = 0;
  let aR = 0;
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < left.length; i++) {
    if (left[i]) {
      aL++;
      sumL += grey[i];
    }
    if (right[i]) {
      aR++;
      sumR += grey[i];
    }
  }
  if (aL > 0 && aR > 0) {
    measurements.push({ id: "lung_area_asymmetry", value: r4(Math.abs(aL - aR) / Math.max(aL, aR)), maskIds: both });
    // Density: mean brightness inside each lung (brighter = denser on X-ray).
    measurements.push({ id: "density_ratio", value: r4(sumL / aL / (sumR / aR)), maskIds: both });
  }

  // Costophrenic blunting heuristic, per lung.
  const leftBlunt = blunting(left, w, h, "right");
  const rightBlunt = blunting(right, w, h, "left");
  if (leftBlunt !== null) measurements.push({ id: "cp_blunting_left", value: leftBlunt, maskIds: [input.leftMaskId] });
  if (rightBlunt !== null) measurements.push({ id: "cp_blunting_right", value: rightBlunt, maskIds: [input.rightMaskId] });

  return { measurements, heartBox, ctrLines };
}

/**
 * 0 (sharp angle) to 1 (blunted). In the bottom 15% of the lung, compare how
 * much lung fills the outer (lateral) 30% against the inner 30%: a normal
 * costophrenic angle reaches as low laterally as medially; fluid fills the
 * angle first, so the lateral corner empties. `lateral` is the image side the
 * outer edge is on (patient's left lung -> image right).
 */
export function blunting(mask: Uint8Array, w: number, h: number, lateral: "left" | "right"): number | null {
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  // A lung that runs to the bottom edge was cut off by the framing: the
  // angle is not on the film, so blunting cannot be judged either way.
  if (y1 >= h - Math.max(2, Math.round(0.01 * h))) return null;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const bandTop = y1 - Math.max(1, Math.round(0.15 * bh)) + 1;
  const third = Math.max(1, Math.round(0.3 * bw));
  const fill = (xa: number, xb: number) => {
    let on = 0;
    let all = 0;
    for (let y = bandTop; y <= y1; y++) {
      for (let x = xa; x <= xb; x++) {
        all++;
        if (mask[y * w + x]) on++;
      }
    }
    return all ? on / all : 0;
  };
  const leftFill = fill(x0, x0 + third - 1);
  const rightFill = fill(x1 - third + 1, x1);
  const lateralFill = lateral === "left" ? leftFill : rightFill;
  const medialFill = lateral === "left" ? rightFill : leftFill;
  // A lung that reaches lower laterally than medially has a sharp angle.
  if (medialFill === 0) return lateralFill > 0 ? 0 : null;
  return r4(Math.min(1, Math.max(0, 1 - lateralFill / medialFill)));
}

export type FlagLevel = "critical" | "urgent" | "flag";

export interface MeasurementFlag {
  measurementId: MeasurementId;
  level: FlagLevel;
  value: number;
  threshold: number;
}

/** Pure: which measurements cross a threshold. CTR only on PA films. */
export function evaluateMeasurements(measurements: Measurement[], view: "PA" | "AP" | "lateral" | "unknown"): MeasurementFlag[] {
  const flags: MeasurementFlag[] = [];
  for (const m of measurements) {
    switch (m.id) {
      case "lung_area_asymmetry": {
        const t = THRESHOLDS.lungAreaAsymmetry;
        if (m.value >= t.critical) flags.push({ measurementId: m.id, level: "critical", value: m.value, threshold: t.critical });
        else if (m.value >= t.urgent) flags.push({ measurementId: m.id, level: "urgent", value: m.value, threshold: t.urgent });
        break;
      }
      case "cardiothoracic_ratio": {
        const t = THRESHOLDS.cardiothoracicRatio.urgent;
        if (view === "PA" && m.value >= t) flags.push({ measurementId: m.id, level: "urgent", value: m.value, threshold: t });
        break;
      }
      case "cp_blunting_left":
      case "cp_blunting_right": {
        const t = THRESHOLDS.costophrenicBlunting.flag;
        if (m.value >= t) flags.push({ measurementId: m.id, level: "flag", value: m.value, threshold: t });
        break;
      }
      case "density_ratio": {
        const t = THRESHOLDS.densityRatio.flag;
        if (m.value >= t || m.value <= 1 / t) flags.push({ measurementId: m.id, level: "flag", value: m.value, threshold: t });
        break;
      }
    }
  }
  return flags;
}
