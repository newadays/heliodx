/**
 * B16 · Patient summary checks. The patient summary is a plain-language
 * rewrite of the SIGNED report only. The model rewrites; code decides what
 * is allowed:
 *
 * - "What happens next" is mapped by construction: one plain-language step
 *   per sentence of the signed Recommendation, same order (`mapsTo`).
 * - A step may not add a number, timeframe, dose or medicine word that its
 *   signed sentence does not contain.
 * - The body may name a condition only when the signed Impression does.
 * - Reading level is measured here (Flesch–Kincaid grade, target ≤ 8).
 *
 * Whatever still fails after one retry falls back to the clinician's own
 * words (steps) or is dropped (body sentences), so nothing unsigned reaches
 * the patient. Pure functions; no I/O.
 */
import { assertedConditions } from "./vocabulary";

export const TARGET_GRADE = 8;
export const MAX_STEPS = 8;

export interface NextStep {
  text: string;
  /** Index of the sentence in the signed Recommendation this step rewrites. */
  mapsTo: number;
  /** Ticked by the clinician; sharing needs every step confirmed. */
  confirmed: boolean;
  /** The rewrite failed the checks, so the signed sentence is used word for word. */
  fromSignedText?: boolean;
}

export interface PatientSummary {
  title: string;
  body: string;
  nextSteps: NextStep[];
  /** The signer's name, e.g. "Dr. A. Smith". */
  reviewedBy: string;
  /** "Reviewed and approved by Dr. A. Smith" (+ " (simulated)" for demo signers). */
  attribution: string;
  /** Flesch–Kincaid grade of the body and steps. */
  readingGrade: number;
  /** `signed.reportHash` of the report this was written from. */
  generatedFromReportHash: string;
  editedByClinician: boolean;
  /**
   * The text as generated, kept so the share step can tell which parts the
   * clinician edited (B17). Written only here; rules forbid client changes.
   */
  generated: { body: string; steps: string[] };
}

/** What the model returns. */
export interface PatientRewrite {
  body: string;
  nextSteps: string[];
}

/** The signed text the rewrite may use, and nothing else. */
export interface SignedText {
  studyType: string;
  findings: string;
  impression: string[];
  recommendation: string;
}

// ---- sentences and reading level --------------------------------------------

/** Sentences of a paragraph; a paragraph without end punctuation is one sentence. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|St|vs|approx|e\.g|i\.e)\.)(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Signed Recommendation sentences, capped so the list stays readable. */
export function recommendationSentences(recommendation: string): string[] {
  const all = splitSentences(recommendation);
  if (all.length <= MAX_STEPS) return all;
  return [...all.slice(0, MAX_STEPS - 1), all.slice(MAX_STEPS - 1).join(" ")];
}

const WORD = /[A-Za-z][A-Za-z'-]*/g;

export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade level, rounded to one decimal; 0 for empty text. */
export function fleschKincaidGrade(text: string): number {
  const sentences = splitSentences(text);
  const words = text.match(WORD) ?? [];
  if (!sentences.length || !words.length) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

// ---- new-instruction check --------------------------------------------------

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", eleven: "11", twelve: "12", twice: "2x", thrice: "3x",
  single: "1", couple: "2", few: "few", several: "several",
};
const TIME_WORDS = new Set([
  "minute", "hour", "day", "week", "month", "year", "daily", "weekly", "monthly", "yearly",
  "annual", "annually", "tomorrow", "tonight", "overnight", "fortnight", "morning", "evening", "night",
]);
const DOSE_WORDS = new Set(["mg", "mcg", "µg", "ug", "ml", "iu", "dose", "dosage", "tablet", "pill", "capsule", "puff", "drop", "injection"]);
// Added tests and urgency are instructions too ("Your doctor may order a CT
// scan", "Go to the emergency room immediately"). "X-ray" splits to "x"+"ray".
const TEST_WORDS = new Set(["test", "scan", "ct", "mri", "ultrasound", "biopsy", "ray", "bloodwork", "echo", "echocardiogram", "bronchoscopy"]);
const URGENCY_WORDS = new Set(["immediately", "urgent", "urgently", "emergency", "asap", "straightaway"]);
const MEDICINE_WORDS = new Set([
  "medicine", "medication", "drug", "antibiotic", "antibiotics", "inhaler", "steroid", "prescription",
  "painkiller", "paracetamol", "ibuprofen", "aspirin", "amoxicillin", "diuretic", "vaccine",
]);

function singular(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Numbers, timeframes, dose and medicine words in the text, normalised. */
export function instructionTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const n of text.match(/\d+(?:[.,]\d+)?/g) ?? []) out.add(n.replace(",", "."));
  if (/\bas soon as possible\b|\bright away\b/i.test(text)) out.add("asap");
  for (const raw of text.toLowerCase().match(/[a-zµ]+/g) ?? []) {
    const w = singular(raw);
    if (NUMBER_WORDS[raw]) out.add(NUMBER_WORDS[raw]);
    else if (TIME_WORDS.has(w) || TIME_WORDS.has(raw)) out.add(w);
    else if (DOSE_WORDS.has(w) || DOSE_WORDS.has(raw)) out.add(w);
    else if (MEDICINE_WORDS.has(raw) || MEDICINE_WORDS.has(w)) out.add(w);
    else if (TEST_WORDS.has(w) || TEST_WORDS.has(raw)) out.add(w);
    else if (URGENCY_WORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Terms the rewrite adds that the signed sentence does not contain. */
export function newInstructionTerms(signed: string, rewrite: string): string[] {
  const allowed = instructionTerms(signed);
  return [...instructionTerms(rewrite)].filter((t) => !allowed.has(t));
}

/**
 * Condition names the text asserts that the signed Impression does not
 * (plus `alsoSigned`, e.g. the step's own signed sentence). Compared with what
 * the Impression asserts, so "No pneumothorax." does not allow "You have a
 * pneumothorax." "Effusion" and "pleural effusion" count as the same.
 */
export function conditionViolations(text: string, impression: string[], alsoSigned = ""): string[] {
  const allowed = [...impression, alsoSigned].flatMap((s) => assertedConditions(s));
  return assertedConditions(text).filter((term) => !allowed.some((a) => a.includes(term) || term.includes(a)));
}

/** Condition names the body asserts that the signed Impression does not. */
export function bodyConditionViolations(body: string, impression: string[]): string[] {
  return conditionViolations(body, impression);
}

// ---- checking a rewrite -----------------------------------------------------

export interface RewriteCheck {
  /** Per step index: the terms it added (empty = clean); missing steps count as failed. */
  steps: { text: string | null; added: string[] }[];
  /** Body sentences that name a condition the Impression does not. */
  bodyViolations: string[];
  grade: number;
  ok: boolean;
}

export function checkRewrite(rewrite: PatientRewrite, sentences: string[], impression: string[]): RewriteCheck {
  const steps = sentences.map((signed, i) => {
    const text = (rewrite.nextSteps[i] ?? "").trim();
    if (!text) return { text: null, added: ["(missing)"] };
    return { text, added: [...newInstructionTerms(signed, text), ...conditionViolations(text, impression, signed)] };
  });
  const body = rewrite.body.trim();
  const bodyViolations = bodyConditionViolations(body, impression);
  const grade = fleschKincaidGrade([body, ...steps.map((s) => s.text ?? "")].join(" "));
  const ok = steps.every((s) => s.added.length === 0) && bodyViolations.length === 0 && grade <= TARGET_GRADE && !!body;
  return { steps, bodyViolations, grade, ok };
}

/** What to tell the model on the retry. */
export function retryFeedback(check: RewriteCheck): string {
  const lines: string[] = [];
  check.steps.forEach((s, i) => {
    if (s.added.length) lines.push(`Step ${i + 1} added something the report does not say (${s.added.join(", ")}). Remove it.`);
  });
  if (check.bodyViolations.length) {
    lines.push(`The body names ${check.bodyViolations.join(", ")}, which the impression does not. Do not name it.`);
  }
  if (check.grade > TARGET_GRADE) {
    lines.push(`Reading level is grade ${check.grade}. Use shorter sentences and everyday words (grade ${TARGET_GRADE} or lower).`);
  }
  return lines.join("\n");
}

// ---- assembling the summary -------------------------------------------------

/** "Chest X-ray (PA)" → "chest X-ray". */
export function studyWords(studyType: string): string {
  const s = studyType.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (!s) return "results";
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export function titleFor(signer: string, studyType: string): string {
  return `A note from ${signer || "your clinician"} about your ${studyWords(studyType)}`;
}

export function attributionFor(signer: string, simulated: boolean): string {
  return `Reviewed and approved by ${signer || "your clinician"}${simulated ? " (simulated)" : ""}`;
}

/**
 * Picks, per part, the first clean candidate (retry first, then the first
 * draft); falls back to the signed sentence for a step and drops offending
 * body sentences when neither is clean.
 */
export function assemble(input: {
  signed: SignedText;
  sentences: string[];
  candidates: PatientRewrite[];
  signer: string;
  simulated: boolean;
  reportHash: string;
}): { summary: PatientSummary; flagged: number } {
  const { signed, sentences, candidates } = input;
  const checks = candidates.map((c) => checkRewrite(c, sentences, signed.impression));
  const order = checks.map((_, i) => i).reverse(); // latest attempt first

  const nextSteps: NextStep[] = sentences.map((sentence, i) => {
    for (const k of order) {
      const s = checks[k].steps[i];
      if (s.text && s.added.length === 0) return { text: s.text, mapsTo: i, confirmed: false };
    }
    return { text: sentence, mapsTo: i, confirmed: false, fromSignedText: true };
  });

  let body = "";
  for (const k of order) {
    const b = candidates[k].body.trim();
    if (b && checks[k].bodyViolations.length === 0) {
      body = b;
      break;
    }
  }
  if (!body) {
    const latest = candidates[candidates.length - 1]?.body ?? "";
    body = splitSentences(latest)
      .filter((s) => bodyConditionViolations(s, signed.impression).length === 0)
      .join(" ")
      .trim();
  }
  if (!body) body = `Your clinician has reviewed your ${studyWords(signed.studyType)}.`;

  const grade = fleschKincaidGrade([body, ...nextSteps.map((s) => s.text)].join(" "));
  return {
    summary: {
      title: titleFor(input.signer, signed.studyType),
      body,
      nextSteps,
      reviewedBy: input.signer || "Your clinician",
      attribution: attributionFor(input.signer, input.simulated),
      readingGrade: grade,
      generatedFromReportHash: input.reportHash,
      editedByClinician: false,
      generated: { body, steps: nextSteps.map((s) => s.text) },
    },
    flagged: nextSteps.filter((s) => s.fromSignedText).length,
  };
}
