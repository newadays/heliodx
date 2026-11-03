/**
 * B26 · Patterns of concern, as data: one real pattern plus `none`. A pattern
 * is a radiographic signal that the film needs attention first. It names what
 * is seen, never a disease, and never goes in a finding title, the findings
 * paragraph or the patient note. Pure (no Firebase): the web app imports it
 * for the label.
 */

export type PatternId = "pattern_of_concern" | "none";

export interface Pattern {
  label: string;
  concern: "urgent" | "none";
  /** What the model looks for (prep prompt): radiographic features only. */
  cues: string;
}

export const PATTERNS: Record<PatternId, Pattern> = {
  pattern_of_concern: {
    label: "Pattern of concern",
    concern: "urgent",
    cues: "upper-zone patchy or nodular opacities, cavitation, apical fibrotic change, unilateral upper-lobe volume loss, miliary nodules",
  },
  none: { label: "", concern: "none", cues: "" },
};

/** Stored and older ids read as the pattern of concern (studies and eval records from before the rename). */
const LEGACY = new Set(["tb_suggestive", "tb", "tuberculosis_suggestive"]);

/** The model's free text read in code: "pattern_of_concern", "none", or null when unknown (treated as none). */
export function patternOf(text: string | null | undefined): PatternId | null {
  const t = (text ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "pattern_of_concern" || t === "concern" || LEGACY.has(t)) return "pattern_of_concern";
  if (t === "none" || t === "") return "none";
  return null;
}

/** True when any finding carries the pattern of concern on an abnormal observation. */
export function hasPatternOfConcern(findings: readonly { abnormal?: boolean; pattern?: string | null }[]): boolean {
  return findings.some((f) => f.abnormal === true && patternOf(f.pattern) === "pattern_of_concern");
}

/** B26: a pattern of concern raises a routine study to urgent; never lowers. */
export function patternLift(findings: readonly { abnormal?: boolean; pattern?: string | null }[], priority: string | null | undefined): "urgent" | null {
  return hasPatternOfConcern(findings) && (priority ?? "routine") === "routine" ? "urgent" : null;
}
