/**
 * One-line evidence and polarity for a finding (cards B21, W5), from the
 * measurements it cites and the thresholds: "Cardiothoracic ratio 0.45 ·
 * limit 0.55". Pure (no Firebase), so the web client renders the same line
 * for studies drafted before these fields were stored.
 */
import type { MeasurementId } from "../tools/measure";
import { thresholdFor } from "./strength";

export interface EvidenceMeasurement {
  id: string;
  value: number;
}

export interface EvidenceFlag {
  measurementId: string;
}

export type Polarity = "normal" | "attention";

const r2 = (n: number): string => String(Math.round(n * 100) / 100);
const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

const KNOWN = new Set<string>(["cardiothoracic_ratio", "lung_area_asymmetry", "cp_blunting_left", "cp_blunting_right", "density_ratio"]);

function part(id: MeasurementId, value: number): string {
  const limit = thresholdFor(id);
  switch (id) {
    case "cardiothoracic_ratio":
      return `Cardiothoracic ratio ${r2(value)} · limit ${r2(limit)}`;
    case "lung_area_asymmetry":
      return `Area difference ${pct(value)} · limit ${pct(limit)}`;
    case "density_ratio":
      return `Left/right mean brightness ratio ${r2(value)} · limit ${r2(limit)}`;
    case "cp_blunting_left":
      return `Left blunting ${r2(value)} · limit ${r2(limit)}`;
    case "cp_blunting_right":
      return `Right blunting ${r2(value)} · limit ${r2(limit)}`;
  }
}

/**
 * The measured values a finding rests on, with their limits; null when it
 * rests on outlines only (the UI then shows the description). Both
 * costophrenic angles read as one "Blunting right / left" pair.
 */
export function evidenceLine(measurementIds: readonly string[], measurements: readonly EvidenceMeasurement[]): string | null {
  const byId = new Map(measurements.map((m) => [m.id, m.value]));
  const ids = measurementIds.filter((id) => KNOWN.has(id) && byId.has(id)) as MeasurementId[];
  if (!ids.length) return null;
  const parts: string[] = [];
  const both = ids.includes("cp_blunting_left") && ids.includes("cp_blunting_right");
  for (const id of ids) {
    if (both && id === "cp_blunting_left") continue;
    if (both && id === "cp_blunting_right") {
      parts.push(`Blunting ${r2(byId.get("cp_blunting_right")!)} / ${r2(byId.get("cp_blunting_left")!)} · limit ${r2(thresholdFor(id))}`);
      continue;
    }
    parts.push(part(id, byId.get(id)!));
  }
  return parts.join("; ");
}

/** Attention when any measurement it cites crossed its threshold (a triage flag). */
export function polarityOf(measurementIds: readonly string[], flags: readonly EvidenceFlag[]): Polarity {
  const flagged = new Set(flags.map((f) => f.measurementId));
  return measurementIds.some((id) => flagged.has(id)) ? "attention" : "normal";
}

/** Confidence band (SPEC §3): high ≥ 0.85, moderate ≥ 0.6, else low. `confidence` is 0–1. */
export function confidenceBand(confidence: number): "high" | "moderate" | "low" {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "moderate";
  return "low";
}
