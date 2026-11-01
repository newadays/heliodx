/**
 * B26 · Patterns of concern, as data. TB only until we can grow: one real
 * pattern plus `none`. A pattern is a hedged signal for the clinician, never a
 * diagnosis: it stays out of finding titles, the findings paragraph and the
 * patient note until the clinician adopts it and signs. Pure (no Firebase):
 * the web app imports it for the label.
 */
import { assertedConditions } from "./vocabulary";

export type PatternId = "tb_suggestive" | "none";

export interface Pattern {
  label: string;
  concern: "urgent" | "none";
  /** What the model looks for (prep prompt). */
  cues: string;
  /** The consideration offered to the clinician. */
  clinician: string;
  /** The patient's wording once the clinician has signed it. */
  plain: string;
  /** Condition names a consideration for this pattern may assert. */
  conditionTerms: string[];
}

export const PATTERNS: Record<PatternId, Pattern> = {
  tb_suggestive: {
    label: "TB-suggestive",
    concern: "urgent",
    cues: "upper-zone patchy or nodular opacities, cavitation, apical fibrotic change, unilateral upper-lobe volume loss, miliary nodules",
    clinician: "Pattern suggestive of pulmonary tuberculosis. Consider sputum GeneXpert or AFB and clinical correlation.",
    plain: "changes at the top of the lungs that can be caused by an infection called tuberculosis (TB). The X-ray alone cannot confirm it.",
    conditionTerms: ["tuberculosis", "tb"],
  },
  none: { label: "", concern: "none", cues: "", clinician: "", plain: "", conditionTerms: [] },
};

/** The model's free text read in code: "tb_suggestive", "none", or null when unknown (treated as none). */
export function patternOf(text: string | null | undefined): PatternId | null {
  const t = (text ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (t === "tb_suggestive" || t === "tb" || t === "tuberculosis_suggestive") return "tb_suggestive";
  if (t === "none" || t === "") return "none";
  return null;
}

/** True when any finding carries the TB-suggestive tag on an abnormal observation. */
export function hasTbPattern(findings: readonly { abnormal?: boolean; pattern?: string | null }[]): boolean {
  return findings.some((f) => f.abnormal === true && f.pattern === "tb_suggestive");
}

/**
 * Considerations kept for the clinician: none unless a finding is tagged, and
 * each may assert only the pattern's own condition names (TB), never another.
 */
export function keepConsiderations(considerations: readonly string[] | undefined, tagged: boolean): string[] {
  if (!tagged) return [];
  const allowed = new Set(PATTERNS.tb_suggestive.conditionTerms);
  return (considerations ?? [])
    .map((c) => c.trim())
    .filter((c) => c && assertedConditions(c).every((term) => allowed.has(term)))
    .slice(0, 2);
}

/** B26: a TB-suggestive pattern raises a routine study to urgent; never lowers. */
export function patternLift(findings: readonly { abnormal?: boolean; pattern?: string | null }[], priority: string | null | undefined): "urgent" | null {
  return hasTbPattern(findings) && (priority ?? "routine") === "routine" ? "urgent" : null;
}
