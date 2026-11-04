/**
 * Compliance · the no-diagnosis guard. AI text describes what is seen; it never
 * names a disease as present, gives a likelihood of one, or makes a diagnosis.
 * Builds on the condition list in vocabulary.ts and adds diagnostic phrasing.
 * Pure (no Firebase).
 */
import { assertedConditions } from "./vocabulary";

/** Diagnostic phrasing that is banned even without a listed condition name. */
const PHRASES = [
  "consistent with",
  "suggestive of",
  "(?:likelihood|probability|chance) of",
  "likely (?:infective|infectious|infection|malignant|benign)",
  "diagnos(?:is|es|e|ed|tic)",
];
const PHRASE = new RegExp(`\\b(${PHRASES.join("|")})\\b`, "gi");
/** "not a diagnosis", "no diagnosis" stay allowed: they are the disclaimer. */
const DISCLAIMER = /\b(not|no|never)\s+(a\s+)?$/i;

/** What in the text breaks the rule, lower-case: condition names asserted and diagnostic phrases. */
export function diagnosisTerms(text: string): string[] {
  const out = new Set(assertedConditions(text));
  let m: RegExpExecArray | null;
  const re = new RegExp(PHRASE.source, "gi");
  while ((m = re.exec(text))) {
    if (!DISCLAIMER.test(text.slice(Math.max(0, m.index - 12), m.index))) out.add(m[0].toLowerCase());
  }
  return [...out];
}

/** True when the text breaks the rule; `allowed` are terms the clinician wrote themselves. */
export function namesDiagnosis(text: string, allowed: readonly string[] = []): boolean {
  return diagnosisTerms(text).some((t) => !allowed.includes(t));
}

/** Drop the sentences that break the rule; keep the rest. */
export function stripDiagnosis(text: string, allowed: readonly string[] = []): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !namesDiagnosis(s, allowed))
    .join(" ")
    .trim();
}

/** The labelled texts that break the rule, for a re-ask and the trace: `["title 2: consistent with"]`. */
export function diagnosisHits(texts: readonly { where: string; text: string }[]): string[] {
  return texts.flatMap(({ where, text }) => {
    const terms = diagnosisTerms(text);
    return terms.length ? [`${where}: ${terms.join(", ")}`] : [];
  });
}

/** The feedback appended to a prompt when the first answer broke the rule. */
export function reaskFeedback(hits: readonly string[]): string {
  return [
    "Your previous answer named a disease, gave a likelihood of one or used diagnostic wording in:",
    ...hits.map((h) => `- ${h}`),
    "Rewrite every text as observations only: what is seen, where, and the measured value. Leave naming it to the clinician.",
  ].join("\n");
}
