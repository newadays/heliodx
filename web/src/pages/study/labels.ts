/**
 * Card B27 · Where the viewer draws each abnormal zone and its label chip.
 * Pure: % of the film in, % of the film out. Outlines are zone ellipses
 * (B25: SAM finds no lesions, so a zone is that lung's width × a third of
 * the chest). Radiological convention: the patient's right lung is on the
 * image's left, so its chip goes on the image's left edge.
 */
import type { FindingView } from "~/data/model";

export interface PlacedLabel {
  n: number;
  key: string;
  /** Ellipse centre and radii. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Chip anchor: its outer edge (left/right) or bottom centre (top) sits here. */
  chip: { x: number; y: number; align: "left" | "right" | "top" };
  /** Leader line from the ellipse's outer edge to the chip. */
  line: { x1: number; y1: number; x2: number; y2: number };
  text: string;
  aria: string;
}

const EDGE = 3;
const GAP = 6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One entry per outline of every abnormal, non-rejected finding; chips on one side never overlap. */
export function placeLabels(findings: Pick<FindingView, "n" | "abnormal" | "decision" | "outlines" | "patternLabel">[]): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const f of findings) {
    if (!f.abnormal || f.decision === "rejected") continue;
    f.outlines.forEach((o, i) => {
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      const rx = o.w / 2;
      const ry = o.h / 2;
      const place = o.kind === "heart" || !o.side ? "top" : o.side === "right" ? "left" : "right";
      const where = o.side ? `${o.side} lung${o.zone ? ` ${o.zone} zone` : ""}` : "heart region";
      const text = f.patternLabel ?? `Attention · ${f.n}`;
      // Side chips sit just outside the zone's outer-top corner (below it when there is no room above),
      // against the film's outer edge, so the leader line stays visible.
      const above = o.y - GAP >= 4;
      const chipY = above ? o.y - GAP : clamp(o.y + o.h + GAP, 4, 96);
      const chip =
        place === "left"
          ? { x: EDGE, y: chipY, align: "left" as const }
          : place === "right"
            ? { x: 100 - EDGE, y: chipY, align: "right" as const }
            : { x: cx, y: clamp(o.y - GAP, 4, 96), align: "top" as const };
      // The ellipse point at 45° towards the chip.
      const k = Math.SQRT1_2;
      const x1 = place === "left" ? cx - rx * k : place === "right" ? cx + rx * k : cx;
      const y1 = place === "top" ? cy - ry : above ? cy - ry * k : cy + ry * k;
      out.push({
        n: f.n,
        key: `${f.n}-${i}`,
        cx,
        cy,
        rx,
        ry,
        chip,
        line: { x1, y1, x2: place === "left" ? chip.x + 4 : place === "right" ? chip.x - 4 : chip.x, y2: chip.y },
        text,
        aria: `Finding ${f.n}, ${where}${f.patternLabel ? `, ${f.patternLabel}` : ", needs attention"}`,
      });
    });
  }
  // Stack chips that share a side so they never overlap: keep order by height, push down by GAP.
  for (const align of ["left", "right", "top"] as const) {
    const side = out.filter((l) => l.chip.align === align).sort((a, b) => a.chip.y - b.chip.y);
    for (let i = 1; i < side.length; i++) {
      if (side[i].chip.y - side[i - 1].chip.y < GAP) side[i].chip.y = clamp(side[i - 1].chip.y + GAP, 4, 96);
    }
    for (const l of side) l.line.y2 = l.chip.y;
  }
  return out;
}
