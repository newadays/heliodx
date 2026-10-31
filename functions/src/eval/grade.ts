/**
 * E10 · Deterministic grading for the evaluation task library (E1).
 *
 * One pure function per family. Each takes the task and what a system
 * produced (recorded by `scripts/eval.ts`) and returns one result per
 * criterion. The app's own filters run before anything is saved (Prep drops
 * observations that name a condition or cite nothing; triage keeps only real
 * evidence ids), so grading the saved output alone would always pass. These
 * criteria grade what the model proposed before those filters, which is where
 * two models differ.
 */
import type { CriterionResult, EvalCriterion, EvalFamily, EvalTask, IntakeVariant, Lane } from "./types";
import { findingPolarity } from "../lib/polarity";
import { conditionViolations, newInstructionTerms, TARGET_GRADE, type PatientRewrite } from "../lib/patientSummary";

// ---- What the runner records per family ------------------------------------

export interface IntakeOutcome {
  retake: boolean;
  issues: string[];
  warnings: string[];
  modality: string;
  view: string;
  chest: boolean;
}

export interface TriageOutcome {
  priority: Lane;
  /** The lane from measurements alone, before the model. */
  floor: Lane;
  /** Evidence ids the model cited, before filtering. */
  cited: string[];
  /** Measurement and mask ids that exist for this film. */
  allowed: string[];
  /** True when the model call failed and the case went to a human. */
  needsHuman: boolean;
  flags: string[];
  rationale: string;
}

export interface PrepOutcome {
  findings: { title: string; description: string; polarity?: "normal" | "attention"; evidence: { measurementIds: string[]; maskIds: string[] } }[];
  flagged: string[];
  dropped: { conditions: number; noEvidence: number };
  proposed: number;
  impression: string[];
  /** True when every impression line was removed and the app's fallback line was used. */
  impressionFallback: boolean;
  recommendation: string;
}

export interface NoteOutcome {
  sentences: string[];
  impression: string[];
  /** The model's first rewrite, before the retry and before assembly. */
  first: PatientRewrite;
  firstGrade: number;
  firstOk: boolean;
  attempts: number;
  /** Steps in the final note that fell back to the signed sentence. */
  flagged: number;
  readingGrade: number;
}

// ---- Criteria per family, shared by the task builder and the grader --------

const c = (id: string, label: string): EvalCriterion => ({ id, label, method: "deterministic" });

export const BLURRED = "Image looks blurred.";
export const LOW_RES = "Image resolution is too low.";
export const NOT_MEDICAL = "This does not look like a medical image.";

export function intakeCriteria(variant: IntakeVariant): EvalCriterion[] {
  switch (variant) {
    case "clean":
      return [c("no_retake", "Not sent back for a retake"), c("modality", "Recognised as an X-ray"), c("view", "View read as PA"), c("chest", "Both lungs found")];
    case "blur":
      return [c("retake", "Sent back for a retake"), c("reason", "Names the blur as the reason")];
    case "lowres":
      return [c("retake", "Sent back for a retake"), c("reason", "Names the low resolution as the reason")];
    case "nonmedical":
      return [c("retake", "Sent back for a retake"), c("not_medical", "Says it is not a medical image")];
  }
}

export function triageCriteria(lane: Lane): EvalCriterion[] {
  return [
    lane === "routine" ? c("lane", "Stays routine (not over-triaged)") : c("lane", `Lane ${lane} or higher`),
    c("answered", "Model answered (no fallback to a human)"),
    c("evidence", "Every cited measurement or outline exists"),
  ];
}

export function prepCriteria(polarity: "normal" | "attention"): EvalCriterion[] {
  return [
    c("drafted", "At least one observation with evidence"),
    c("no_condition", "No proposed observation names a condition"),
    c("no_uncited", "No proposed observation without evidence"),
    polarity === "attention" ? c("polarity", "Flags at least one observation for attention") : c("polarity", "Flags nothing for attention"),
    c("impression", "Impression survives the condition filter"),
  ];
}

export function noteCriteria(): EvalCriterion[] {
  return [
    c("steps", "One step per signed recommendation sentence"),
    c("no_added", "No added number, timeframe, dose, medicine, test or urgency word"),
    c("no_condition", "No condition the impression does not assert"),
    c("grade", `Reading grade ${TARGET_GRADE} or lower`),
    c("first_try", "Passes every check on the first try"),
  ];
}

// ---- Grading ----------------------------------------------------------------

const LANES: Lane[] = ["routine", "urgent", "critical"];
const rank = (l: Lane) => LANES.indexOf(l);

type Verdict = { pass: boolean | null; detail: string };

function apply(criteria: EvalCriterion[], verdicts: Record<string, Verdict>): CriterionResult[] {
  return criteria.map((cr) => ({ ...cr, ...(verdicts[cr.id] ?? { pass: null, detail: "not graded" }) }));
}

export function gradeIntake(task: EvalTask, out: IntakeOutcome): CriterionResult[] {
  const e = task.expected;
  const reason = task.variant === "blur" ? BLURRED : LOW_RES;
  return apply(task.criteria, {
    no_retake: { pass: !out.retake, detail: out.retake ? `retake: ${out.issues.join("; ")}` : "accepted" },
    retake: { pass: out.retake, detail: out.retake ? `retake: ${out.issues.join("; ")}` : "accepted" },
    reason: { pass: out.issues.includes(reason), detail: out.issues.join("; ") || "no blocking issue" },
    not_medical: { pass: out.issues.includes(NOT_MEDICAL), detail: out.issues.join("; ") || "no blocking issue" },
    modality: { pass: out.modality === (e.modality ?? "xray"), detail: `modality ${out.modality}` },
    view: { pass: out.view === (e.view ?? "PA"), detail: `view ${out.view}` },
    chest: { pass: out.chest === (e.chest ?? true), detail: out.chest ? "both lungs found" : "lungs not confirmed" },
  });
}

export function gradeTriage(task: EvalTask, out: TriageOutcome): CriterionResult[] {
  const want = task.expected.lane ?? "routine";
  const lanePass = want === "routine" ? out.priority === "routine" : rank(out.priority) >= rank(want);
  const allowed = new Set(out.allowed);
  const unknown = out.cited.filter((id) => !allowed.has(id.trim()));
  return apply(task.criteria, {
    lane: { pass: lanePass, detail: `${out.priority} (expected ${want}; measurements alone ${out.floor})` },
    answered: { pass: !out.needsHuman, detail: out.needsHuman ? "model call failed; sent to a human" : "answered" },
    evidence: {
      pass: !out.needsHuman && unknown.length === 0,
      detail: out.needsHuman ? "no answer" : unknown.length ? `unknown ids: ${unknown.join(", ")}` : `${out.cited.length} cited, all exist`,
    },
  });
}

export function gradePrep(task: EvalTask, out: PrepOutcome): CriterionResult[] {
  const attention = out.findings.filter((f) => findingPolarity(f, out.flagged) === "attention").length;
  const want = task.expected.polarity ?? "normal";
  return apply(task.criteria, {
    drafted: { pass: out.findings.length > 0, detail: `${out.findings.length} of ${out.proposed} proposed kept` },
    no_condition: { pass: out.dropped.conditions === 0, detail: `${out.dropped.conditions} dropped for naming a condition` },
    no_uncited: { pass: out.dropped.noEvidence === 0, detail: `${out.dropped.noEvidence} dropped without evidence` },
    polarity: { pass: want === "attention" ? attention > 0 : attention === 0, detail: `${attention} flagged for attention` },
    impression: { pass: !out.impressionFallback, detail: out.impressionFallback ? "every impression line was removed" : `${out.impression.length} line(s) kept` },
  });
}

export function gradeNote(task: EvalTask, out: NoteOutcome): CriterionResult[] {
  const steps = out.first.nextSteps.map((s) => s.trim()).filter(Boolean);
  const added = out.sentences.flatMap((signed, i) => (steps[i] ? newInstructionTerms(signed, steps[i]) : []));
  const conditions = [
    ...out.sentences.flatMap((signed, i) => (steps[i] ? conditionViolations(steps[i], out.impression, signed) : [])),
    ...conditionViolations(out.first.body, out.impression),
  ];
  return apply(task.criteria, {
    steps: { pass: steps.length === out.sentences.length, detail: `${steps.length} step(s) for ${out.sentences.length} sentence(s)` },
    no_added: { pass: added.length === 0, detail: added.length ? `added: ${[...new Set(added)].join(", ")}` : "nothing added" },
    no_condition: { pass: conditions.length === 0, detail: conditions.length ? `names: ${[...new Set(conditions)].join(", ")}` : "none" },
    grade: { pass: out.firstGrade <= TARGET_GRADE, detail: `grade ${out.firstGrade}` },
    first_try: { pass: out.firstOk, detail: out.firstOk ? "passed" : `retried (${out.attempts} attempts)` },
  });
}

/** Every criterion fails with the error, so a crash scores 0 rather than vanishing. */
export function gradeError(task: EvalTask, error: string): CriterionResult[] {
  return task.criteria.map((cr) => ({ ...cr, pass: false, detail: `run failed: ${error.slice(0, 160)}` }));
}

export function scoreOf(results: CriterionResult[]): number {
  const graded = results.filter((r) => r.pass !== null);
  return graded.length ? graded.filter((r) => r.pass).length / graded.length : 0;
}

export const GRADERS: { [F in EvalFamily]: (task: EvalTask, out: never) => CriterionResult[] } = {
  intake: gradeIntake as never,
  triage: gradeTriage as never,
  prep: gradePrep as never,
  note: gradeNote as never,
};
