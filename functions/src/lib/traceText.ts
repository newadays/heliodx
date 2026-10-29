/**
 * B19 · One-line results for trace events, built in code from numbers and
 * thresholds. Never a condition name, never clinical free text.
 */
import { THRESHOLDS } from "../schemas/thresholds";
import type { Measurement, MeasurementFlag, MeasurementId } from "../tools/measure";
import type { QualityMetrics } from "../tools/quality";

const NAMES: Record<MeasurementId, { tool: string; label: string; threshold: number | null }> = {
  cardiothoracic_ratio: { tool: "measure_ratio", label: "CTR", threshold: THRESHOLDS.cardiothoracicRatio.urgent },
  lung_area_asymmetry: { tool: "compare_area", label: "lung area asymmetry", threshold: THRESHOLDS.lungAreaAsymmetry.urgent },
  cp_blunting_left: { tool: "measure_angle", label: "left costophrenic blunting", threshold: THRESHOLDS.costophrenicBlunting.flag },
  cp_blunting_right: { tool: "measure_angle", label: "right costophrenic blunting", threshold: THRESHOLDS.costophrenicBlunting.flag },
  density_ratio: { tool: "compare_density", label: "L/R density ratio", threshold: THRESHOLDS.densityRatio.flag },
};

export const round = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export function measurementTool(id: MeasurementId): string {
  return NAMES[id]?.tool ?? "measure";
}

/** "L/R density ratio 1.18 · threshold 1.25 · within limits" */
export function describeMeasurement(m: Measurement, flags: MeasurementFlag[]): string {
  const n = NAMES[m.id];
  const flag = flags.find((f) => f.measurementId === m.id);
  const threshold = flag?.threshold ?? n?.threshold ?? null;
  const parts = [`${n?.label ?? m.id} ${round(m.value)}`];
  if (threshold !== null) parts.push(`threshold ${round(threshold)}`);
  parts.push(flag ? `exceeded (${flag.level})` : "within limits");
  return parts.join(" · ");
}

/** "pass · sharpness 58.8 · brightness 113 · clipped 2%" */
export function describeQuality(metrics: QualityMetrics, ok: boolean): string {
  return [
    ok ? "pass" : "retake needed",
    `sharpness ${round(metrics.sharpness, 1)}`,
    `brightness ${Math.round(metrics.mean)}`,
    `clipped ${Math.round(metrics.clipped * 100)}%`,
    `${metrics.width}×${metrics.height}`,
  ].join(" · ");
}

/** "box 412,436→556,724 · score 0.96" */
/** Pixel boxes print as whole pixels; SAM's normalized (0–1) boxes keep two decimals. */
export function describeBox(box: [number, number, number, number], score: number): string {
  const normalized = box.every((v) => Math.abs(v) <= 1);
  const [x1, y1, x2, y2] = box.map((v) => (normalized ? v.toFixed(2) : String(Math.round(v))));
  return `box ${x1},${y1}→${x2},${y2} · score ${round(score)}`;
}
