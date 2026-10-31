/**
 * The anatomy SAM is asked for, as data: the text prompt sent for each label
 * and the score a detection needs to count. Change here, not in code.
 *
 * B9 day-1 probe (2026-10-27, public PA chest X-ray, threshold 0.05): SAM 3.1
 * finds "left lung" 0.74 and "right lung" 0.71 on the correct sides; the
 * generic "lung" scores only 0.25. It finds nothing for "heart", "cardiac
 * silhouette", "heart shadow", "cardiac shadow", "mediastinum", "diaphragm"
 * or "trachea". So only the lungs are segmented; the heart is measured from
 * the gap between the lungs' inner borders (tools/measure.ts, B10).
 *
 * Eval probe (2026-10-31, 24 NIH PA films, threshold 0.1): the best "right
 * lung" detection is always on the correct side but scores 0.23–0.72, under
 * 0.5 on 9 films; the left lung scores 0.39–0.84. Non-medical images return
 * nothing at all. So both labels accept 0.2: confirmStudyType still requires
 * both lungs, on the correct sides and not overlapping.
 */
export type AnatomyLabel = "left lung" | "right lung";

export interface LabelConfig {
  /** Text prompt sent to SAM. */
  prompt: string;
  /** Minimum detection score to accept. */
  threshold: number;
  /** Translucent overlay colour for this structure. */
  color: string;
}

export const ANATOMY: Record<AnatomyLabel, LabelConfig> = {
  "left lung": { prompt: "left lung", threshold: 0.2, color: "#4A90E2" },
  "right lung": { prompt: "right lung", threshold: 0.2, color: "#34C759" },
};

export const CHEST_LABELS: AnatomyLabel[] = ["left lung", "right lung"];

/** "left lung" -> "left-lung"; one mask per label per study. */
export function maskIdFor(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
