/**
 * B12 · Minimal observations-only filter for AI-drafted text (the full
 * vocabulary filter is card B5). AI text describes what is seen; it must not
 * name a disease as present. A condition name is allowed only when negated
 * ("No pneumothorax", "without effusion").
 */
export const CONDITION_TERMS = [
  "pneumonia",
  "tuberculosis",
  "\\btb\\b",
  "covid",
  "cancer",
  "malignan\\w*",
  "carcinoma",
  "tumou?r",
  "metasta\\w*",
  "lymphoma",
  "cardiomegaly",
  "heart failure",
  "pulmonary oedema",
  "pulmonary edema",
  "pleural effusion",
  "effusion",
  "pneumothorax",
  "copd",
  "emphysema",
  "fibrosis",
  "sarcoidosis",
  "abscess",
] as const;
// Not listed: radiological descriptors such as "opacity", "consolidation" or
// "atelectasis" describe what is seen and are allowed.

const TERM = new RegExp(`(${CONDITION_TERMS.join("|")})`, "i");
const NEGATION = /\b(no|without|absence of|not|negative for|free of|nor)\b[^.;:]{0,40}$/i;

/** The condition names the text asserts (not negated just before them), lower-case. */
export function assertedConditions(text: string): string[] {
  const re = new RegExp(TERM.source, "gi");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (!NEGATION.test(before)) out.add(m[0].toLowerCase());
  }
  return [...out];
}

/** True when the text names a condition that is not negated just before it. */
export function assertsCondition(text: string): boolean {
  return assertedConditions(text).length > 0;
}

/** Drop the sentences that assert a condition; keep the rest. */
export function stripConditionSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !assertsCondition(s))
    .join(" ")
    .trim();
}
