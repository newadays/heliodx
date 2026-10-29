/**
 * Triage and quality thresholds as data (card B10). Agents and stages read
 * these; nothing compares against a literal elsewhere. To be tuned on the
 * held-out NIH split (card E3); values here are starting points.
 */
export const THRESHOLDS = {
  /** |left area - right area| / larger area. A normal right lung is ~10% larger. */
  lungAreaAsymmetry: { urgent: 0.15, critical: 0.25 },
  /** Cardiothoracic ratio from the lung borders; PA films only (AP magnifies the heart). */
  cardiothoracicRatio: { urgent: 0.55 },
  /** Costophrenic blunting heuristic, 0 (sharp angle) to 1 (fully blunted). */
  costophrenicBlunting: { flag: 0.6 },
  /** Mean lung brightness ratio (left / right); outside [1/flag, flag] is flagged. */
  densityRatio: { flag: 1.25 },
} as const;

/** Image quality limits, measured on a copy scaled to QUALITY_PX on the long edge. */
export const QUALITY_PX = 512;
export const QUALITY_LIMITS = {
  /**
   * Variance of the Laplacian below this reads as blurred. Calibrated on a
   * public PA film (2026-10-27): original 58.8, Gaussian blur sigma 2 / 4 / 8
   * at 2048 px gave 30.4 / 10.0 / 4.0. X-rays are smooth by nature, so the
   * limit sits well below a sharp film. Recheck on the NIH subset (P5).
   */
  minSharpness: 20,
  /** Fraction of pixels at the extremes (0-3 or 252-255) above this reads as under/over-exposed. */
  maxClipped: 0.25,
  /** Mean brightness outside this range reads as under/over-exposed (sample film: 113). */
  minMean: 40,
  maxMean: 215,
  /** Dynamic range (p99 - p1) below this reads as washed out. */
  minDynamicRange: 80,
  /** Long edge of the original, in pixels. */
  minLongEdgePx: 600,
} as const;
