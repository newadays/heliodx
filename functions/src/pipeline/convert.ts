/**
 * Pure conversions from model output to the study document shape.
 * Unit-tested; no Firebase, no network.
 */
import type { DraftFinding } from "../models/fixtures";
import { findingColor } from "../lib/colors";
import type { FindingsDraft } from "../schemas/study";

export interface Region {
  shape: "ellipse" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Model boxes are [ymin, xmin, ymax, xmax] on a 0–1000 scale (the format the
 * findings prompt asks for). The app draws
 * regions as {x, y, w, h} normalized to 0–1. Degenerate or inverted boxes
 * resolve to null rather than a sliver the clinician cannot see.
 */
export function boxToRegion(box: readonly number[] | null | undefined, shape: "ellipse" | "rect"): Region | null {
  if (!box || box.length !== 4 || box.some((v) => !Number.isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = box.map((v) => clamp01(v / 1000));
  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w < 0.01 || h < 0.01) return null;
  return {
    shape,
    x: round(xmin),
    y: round(ymin),
    w: round(w),
    h: round(h),
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Model findings → study findings: ids, order, colours, pending review. */
export function toFindings(draft: FindingsDraft["findings"]): DraftFinding[] {
  return draft.slice(0, 6).map((f, index) => ({
    id: `f${index + 1}`,
    index,
    title: f.title.trim(),
    description: f.description.trim(),
    confidence: Math.round(Math.min(100, Math.max(0, f.confidence))),
    region: boxToRegion(f.box_2d, f.shape),
    color: findingColor(index),
    status: "pending",
    reviewedAt: null,
  }));
}

export interface Highlight {
  findingId: string;
  start: number;
  end: number;
}

/**
 * Resolve the model's quoted substrings to character offsets in the findings
 * paragraph. Falls back to the finding title when the quote is not found,
 * and drops the highlight when neither matches (the text is still correct;
 * only the tint is missing). Overlaps are removed, earliest wins.
 */
export function resolveHighlights(
  text: string,
  findings: Pick<DraftFinding, "id" | "index" | "title">[],
  quotes: { findingIndex: number; quote: string }[],
): Highlight[] {
  const byIndex = new Map(findings.map((f) => [f.index, f]));
  const out: Highlight[] = [];
  const lower = text.toLowerCase();

  const tryFind = (needle: string): [number, number] | null => {
    const n = needle.trim();
    if (!n) return null;
    let i = text.indexOf(n);
    if (i < 0) i = lower.indexOf(n.toLowerCase());
    return i >= 0 ? [i, i + n.length] : null;
  };

  const seen = new Set<string>();
  for (const q of quotes) {
    const f = byIndex.get(q.findingIndex);
    if (!f || seen.has(f.id)) continue;
    const span = tryFind(q.quote) ?? tryFind(f.title);
    if (!span) continue;
    seen.add(f.id);
    out.push({ findingId: f.id, start: span[0], end: span[1] });
  }
  // Findings the model forgot to quote still get their title highlighted.
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    const span = tryFind(f.title);
    if (span) out.push({ findingId: f.id, start: span[0], end: span[1] });
  }

  out.sort((a, b) => a.start - b.start);
  const nonOverlapping: Highlight[] = [];
  let cursor = -1;
  for (const h of out) {
    if (h.start < cursor) continue;
    nonOverlapping.push(h);
    cursor = h.end;
  }
  return nonOverlapping;
}
