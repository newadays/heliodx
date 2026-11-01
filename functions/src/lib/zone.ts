/**
 * B25 · Where to draw an abnormal observation. SAM 3.1 finds nothing for
 * lesion phrases on chest films (probe 2026-10-31: "patchy opacity",
 * "nodular shadowing", "cavity", "fibrotic streaks", "opacity" score no
 * detection at 0.1), and it tends to miss the opacified part of a lung, so
 * the outline is geometric: the side comes from that lung's box, the zone is
 * a third of the chest's height (the span of both lung boxes), so an upper
 * zone sits at the apex even when the lung mask stops short of it.
 * Radiological convention: the patient's right lung is on the image's left.
 */
import type { ParsedLocation, Side, Zone } from "./location";

type Box = [number, number, number, number];

/** Same shape as `FindingOutline` in types/study.ts (functions cannot import the root types). */
export interface FindingOutline {
  kind: "zone" | "lung" | "heart";
  side: Side | null;
  zone: Zone | null;
  box: Box;
}

export interface ZoneMask {
  label: string;
  box: Box;
}

const ZONE_INDEX: Record<Zone, number> = { upper: 0, middle: 1, lower: 2 };
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function zoneOutlines(loc: ParsedLocation, masks: readonly ZoneMask[], heartBox: Box | null): FindingOutline[] {
  const lungs = masks.filter((m) => m.label === "left lung" || m.label === "right lung");
  if (!lungs.length) return [];
  const top = Math.min(...lungs.map((m) => m.box[1]));
  const bottom = Math.max(...lungs.map((m) => m.box[3]));
  const out: FindingOutline[] = [];
  for (const side of loc.sides) {
    const x = sideSpan(side, lungs);
    if (!x) continue;
    if (loc.zone) {
      const h = (bottom - top) / 3;
      const y0 = top + ZONE_INDEX[loc.zone] * h;
      out.push({ kind: "zone", side, zone: loc.zone, box: [r3(x[0]), r3(y0), r3(x[1]), r3(y0 + h)] });
    } else {
      out.push({ kind: "lung", side, zone: null, box: [r3(x[0]), r3(top), r3(x[1]), r3(bottom)] });
    }
  }
  if (!out.length && loc.heart && heartBox) out.push({ kind: "heart", side: null, zone: null, box: heartBox.map(r3) as Box });
  return out;
}

/** That lung's horizontal span; mirrored from the other lung when its own mask is missing. */
function sideSpan(side: Side, lungs: readonly ZoneMask[]): [number, number] | null {
  const own = lungs.find((m) => m.label === `${side} lung`);
  if (own) return [own.box[0], own.box[2]];
  const other = lungs.find((m) => m.label !== `${side} lung`);
  if (!other) return null;
  return [1 - other.box[2], 1 - other.box[0]];
}

/** The smallest box around every outline: the finding's region. */
export function unionBox(outlines: readonly FindingOutline[]): Box | null {
  if (!outlines.length) return null;
  return [
    Math.min(...outlines.map((o) => o.box[0])),
    Math.min(...outlines.map((o) => o.box[1])),
    Math.max(...outlines.map((o) => o.box[2])),
    Math.max(...outlines.map((o) => o.box[3])),
  ];
}
