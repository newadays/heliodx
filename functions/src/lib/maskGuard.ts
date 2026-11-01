/**
 * B28 · Is a lung outline whole? SAM often outlines only part of an abnormal
 * lung (it misses opacified lung) or returns a sliver at the apex. Across the
 * eval films the shorter lung box's height over the taller one's is either
 * 0.80 or more (a real pair) or 0.25 or less (a sliver); U-SGF4, with its
 * opacified right upper lobe left out, is 0.50. Area, density and angle
 * numbers from a partial outline describe the mask, not the patient, so
 * triage drops them and reports the outline ratio itself (`lung_outline_ratio`,
 * critical): the incomplete outline is the signal, named honestly.
 */
import { THRESHOLDS } from "../schemas/thresholds";
import type { Side } from "./location";

type Lungs = readonly { label: string; box: readonly number[] }[];

/** Shorter lung box height over the taller; null without both lungs. */
export function outlineRatio(masks: Lungs): number | null {
  const left = masks.find((m) => m.label === "left lung");
  const right = masks.find((m) => m.label === "right lung");
  if (!left || !right) return null;
  const hL = left.box[3] - left.box[1];
  const hR = right.box[3] - right.box[1];
  if (hL <= 0 || hR <= 0) return null;
  return Math.round((Math.min(hL, hR) / Math.max(hL, hR)) * 10000) / 10000;
}

export function partialLungs(masks: Lungs): Side[] {
  const ratio = outlineRatio(masks);
  if (ratio === null || ratio >= THRESHOLDS.lungOutlineRatio.critical) return [];
  const hOf = (label: string) => {
    const b = masks.find((m) => m.label === label)!.box;
    return b[3] - b[1];
  };
  return [hOf("right lung") < hOf("left lung") ? "right" : "left"];
}

/** "Right lung outline incomplete" for the app and the prompts; null when both are whole. */
export function partialNote(sides: readonly Side[]): string | null {
  if (!sides.length) return null;
  const s = sides.map((x) => x[0].toUpperCase() + x.slice(1)).join(" and ");
  return `${s} lung outline incomplete: its area, density and angle measurements are not shown.`;
}
