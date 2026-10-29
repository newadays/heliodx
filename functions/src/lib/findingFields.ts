/**
 * B21 · Display fields stored with each finding and study so every client
 * renders the same thing: the evidence line ("Cardiothoracic ratio 0.45 ·
 * limit 0.55"), polarity, marker positions (one per region; a costophrenic
 * pair gets one marker per angle) and the CTR widths drawn on the film.
 * Coordinates are 0–1 of the image. Radiological convention: the patient's
 * right lung is on the image's left.
 */
import type { Span } from "../tools/measure";
import { evidenceLine, polarityOf, type EvidenceFlag, type EvidenceMeasurement } from "./evidence";

export interface FieldsFinding {
  index: number;
  region: { x: number; y: number; w: number; h: number } | null;
  evidence?: { measurementIds: string[]; maskIds: string[] };
}

export interface MaskBox {
  label: string;
  box: [number, number, number, number];
}

export interface FindingFields {
  polarity: "normal" | "attention";
  evidenceLine: string | null;
  regions: { x: number; y: number; label?: string }[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The lower outer corner of a lung outline, inset a little: where the costophrenic angle sits. */
function angleOf(mask: MaskBox | undefined, side: "image-left" | "image-right"): { x: number; y: number } | null {
  if (!mask) return null;
  const [x0, y0, x1, y1] = mask.box;
  const w = x1 - x0;
  const h = y1 - y0;
  return { x: r3(side === "image-left" ? x0 + 0.15 * w : x1 - 0.15 * w), y: r3(y1 - 0.06 * h) };
}

export function findingFields(
  f: FieldsFinding,
  ctx: { measurements: readonly EvidenceMeasurement[]; flags: readonly EvidenceFlag[]; masks: readonly MaskBox[] },
): FindingFields {
  const ids = f.evidence?.measurementIds ?? [];
  const right = ctx.masks.find((m) => m.label === "right lung");
  const left = ctx.masks.find((m) => m.label === "left lung");
  const regions: FindingFields["regions"] = [];
  const cpRight = ids.includes("cp_blunting_right") ? angleOf(right, "image-left") : null;
  const cpLeft = ids.includes("cp_blunting_left") ? angleOf(left, "image-right") : null;
  if (cpRight) regions.push({ ...cpRight, label: "right costophrenic angle" });
  if (cpLeft) regions.push({ ...cpLeft, label: "left costophrenic angle" });
  if (!regions.length && f.region) regions.push({ x: r3(f.region.x + f.region.w / 2), y: r3(f.region.y + f.region.h / 2) });
  return {
    polarity: polarityOf(ids, ctx.flags),
    evidenceLine: evidenceLine(ids, ctx.measurements),
    regions,
  };
}

export interface OverlayLine {
  kind: "line";
  findingIndex: number | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label: string;
}

/** "heart 0.45" and "thorax · CTR 0.45", tied to the finding that cites the ratio. */
export function ctrOverlays(
  lines: { heart: Span; thorax: Span } | null,
  ctr: number | null,
  findings: readonly FieldsFinding[],
): OverlayLine[] {
  if (!lines || ctr === null) return [];
  const owner = findings.find((f) => f.evidence?.measurementIds.includes("cardiothoracic_ratio"))?.index ?? null;
  const v = String(Math.round(ctr * 100) / 100);
  const line = (s: Span, label: string): OverlayLine => ({ kind: "line", findingIndex: owner, from: { x: s.x0, y: s.y }, to: { x: s.x1, y: s.y }, label });
  return [line(lines.heart, `heart ${v}`), line(lines.thorax, `thorax · CTR ${v}`)];
}
