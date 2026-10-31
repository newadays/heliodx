/**
 * E1/E2 · The evaluation task library and its results. The web app reads
 * these types too (`@/functions/src/eval/types`).
 *
 * Tasks are JSON files in `eval/tasks/<family>/<id>.json`, run by
 * `functions/scripts/eval.ts` against each system. Results are written to
 * `evalRuns/{runId}` and `evalRuns/{runId}/results/{taskId}`, which anyone may
 * read (the public /evals page) and no client may write. Nothing here holds a
 * patient identifier: the films are public NIH ChestX-ray14 images and every
 * clinical context is synthetic.
 */

export const EVAL_FAMILIES = ["intake", "triage", "prep", "note"] as const;
export type EvalFamily = (typeof EVAL_FAMILIES)[number];

export const FAMILY_LABEL: Record<EvalFamily, string> = {
  intake: "Intake",
  triage: "Triage",
  prep: "Prep",
  note: "Patient note",
};

/** How a criterion is graded. Only deterministic exists so far (E11, E12 are later). */
export type GradingMethod = "deterministic" | "agent" | "clinician";

export type EvalSystem = "helio" | "medgemma";
export type Lane = "routine" | "urgent" | "critical";

/** How an intake variant was built from its film (ground truth by construction). */
export type IntakeVariant = "clean" | "blur" | "lowres" | "nonmedical";

export interface EvalCriterion {
  id: string;
  label: string;
  method: GradingMethod;
}

export interface EvalTask {
  id: string;
  /** Names the task, never the diagnosis. */
  title: string;
  family: EvalFamily;
  tags: string[];
  /** Tuning half for threshold work (E3); reports use held-out. */
  split: "tuning" | "held-out";
  /** The NIH film; absent for synthetic non-medical intake images. */
  film: { id: string; nihLabel: string; rowIdx: number; source: string } | null;
  variant?: IntakeVariant;
  /** Synthetic, never a real patient's. */
  context: { age: number | null; sex: string | null; indication: string; synthetic: true };
  expected: {
    retake?: boolean;
    blockingReason?: string;
    notMedical?: boolean;
    modality?: string;
    view?: string;
    chest?: boolean;
    lane?: Lane;
    polarity?: "normal" | "attention";
  };
  /** Patient note tasks: the signed text both systems rewrite. */
  signed?: { studyType: string; findings: string; impression: string[]; recommendation: string };
  criteria: EvalCriterion[];
}

export interface CriterionResult extends EvalCriterion {
  /** null when the criterion could not be graded (e.g. the run errored first). */
  pass: boolean | null;
  detail: string;
}

export interface EvalResult {
  taskId: string;
  family: EvalFamily;
  title: string;
  tags: string[];
  split: EvalTask["split"];
  system: EvalSystem;
  model: string;
  /** Share of criteria passed, 0 to 1. */
  score: number;
  criteria: CriterionResult[];
  /** What the system produced, after the app's own filters. Public NIH films, synthetic context. */
  output: Record<string, unknown>;
  latencyMs: number;
  modelMs: number;
  modelCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  error: string | null;
}

export interface FamilySummary {
  tasks: number;
  meanScore: number;
  passRate: number;
  medianLatencyMs: number;
  costPerTaskUsd: number;
}

export interface EvalRun {
  id: string;
  system: EvalSystem;
  label: string;
  model: string;
  precision: string;
  gpu: string;
  commit: string;
  startedAt: string;
  finishedAt: string;
  gpuUsdPerHour: number;
  tasks: number;
  summary: Partial<Record<EvalFamily, FamilySummary>>;
  /** Triage only: critical films sent critical, and normal films sent above routine. */
  triage: { criticalRecall: number | null; abnormalRecall: number | null; overTriage: number | null; floorAbnormalRecall: number | null } | null;
  published: boolean;
}
