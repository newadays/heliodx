/**
 * B12 · Evidence strength, computed in code (never by the model) from what a
 * finding rests on: how far a measurement sits past, or safely inside, its
 * threshold, and how confidently SAM found the regions cited.
 */
import { THRESHOLDS } from "../schemas/thresholds";
import type { Measurement, MeasurementId } from "../tools/measure";

export type Strength = "strong" | "moderate" | "weak";
const ORDER: Strength[] = ["weak", "moderate", "strong"];

/** SAM score below this weakens any finding that cites the mask. */
export const MASK_SCORE_MIN = 0.6;

/** The threshold each measurement is judged against (upper bound unless noted). */
export function thresholdFor(id: MeasurementId): number {
  switch (id) {
    case "cardiothoracic_ratio":
      return THRESHOLDS.cardiothoracicRatio.urgent;
    case "lung_area_asymmetry":
      return THRESHOLDS.lungAreaAsymmetry.urgent;
    case "cp_blunting_left":
    case "cp_blunting_right":
      return THRESHOLDS.costophrenicBlunting.flag;
    case "density_ratio":
      return THRESHOLDS.densityRatio.flag;
  }
}

/**
 * Relative distance from the threshold, whichever side the value is on.
 * Density is two-sided around 1 (flag above `t` or below `1/t`).
 */
export function margin(m: Pick<Measurement, "id" | "value">): number {
  const t = thresholdFor(m.id);
  if (m.id === "density_ratio") {
    const dist = Math.abs(Math.log(m.value));
    const lim = Math.log(t);
    return Math.abs(dist - lim) / lim;
  }
  return Math.abs(m.value - t) / t;
}

function fromMargin(x: number): Strength {
  if (x >= 0.15) return "strong";
  if (x >= 0.05) return "moderate";
  return "weak";
}

/**
 * Strength of one finding. Measurements decide it (the clearest one wins);
 * a finding that rests only on lung outlines is a visual reading and tops out
 * at moderate; any cited mask scored below MASK_SCORE_MIN lowers it a step.
 */
export function strengthOf(measurements: Pick<Measurement, "id" | "value">[], maskScores: number[]): Strength {
  let s: Strength;
  if (measurements.length) {
    s = measurements.map((m) => fromMargin(margin(m))).reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
  } else if (maskScores.length) {
    s = "moderate";
  } else {
    return "weak";
  }
  if (maskScores.some((x) => x < MASK_SCORE_MIN)) s = ORDER[Math.max(0, ORDER.indexOf(s) - 1)];
  return s;
}

/** The app still shows a confidence number until card F5 shows the label. */
export function confidenceFor(s: Strength): number {
  return s === "strong" ? 90 : s === "moderate" ? 70 : 50;
}
