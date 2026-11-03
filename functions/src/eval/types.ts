/**
 * E1/E2 · The evaluation task library and its results. The web app reads
 * these types too (`@/functions/src/eval/types`).
 *
 * Tasks are JSON files in `eval/tasks/<family>/<id>.json`, run by
 * `functions/scripts/eval.ts` against each system. Results are written to
 * `evalRuns/{runId}` and `evalRuns/{runId}/results/{taskId}`, which anyone may
 * read (the public /evals page) and no client may write. Nothing here holds a
 * patient identifier: the films are public NIH ChestX-ray14 images or (TB
 * family, E16) the public Shenzhen and Montgomery TB screening sets, and every
 * indication is synthetic.
 */

export const EVAL_FAMILIES = ["intake", "triage", "prep", "note", "tb"] as const;
export type EvalFamily = (typeof EVAL_FAMILIES)[number];

export const FAMILY_LABEL: Record<EvalFamily, string> = {
  intake: "Intake",
  triage: "Triage",
  prep: "Prep",
  note: "Patient note",
  tb: "Screening clinic",
};

/** How a criterion is graded. Only deterministic exists so far (E11, E12 are later). */
export type GradingMethod = "deterministic" | "agent" | "clinician";

export type EvalSystem = "helio" | "medgemma";
/** E16: the public TB screening sets. */
export type TbDataset = "shenzhen" | "montgomery";
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
  /**
   * The film; absent for synthetic non-medical intake images. NIH films carry
   * `nihLabel` and `rowIdx`; TB-set films (E16) carry `dataset`, the film-level
   * `label` and the consensus ROI boxes (normalised 0–1, [x0, y0, x1, y1]).
   */
  film: {
    id: string;
    nihLabel?: string;
    rowIdx?: number;
    source: string;
    dataset?: TbDataset;
    label?: "tb" | "normal";
    roi?: [number, number, number, number][];
  } | null;
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
    /** TB family: the film-level label. */
    tbSuggestive?: boolean;
    /** TB family: side and zone named by the clinical reading, only when it names a side. */
    zone?: { sides: ("left" | "right")[]; zone: "upper" | "middle" | "lower" | null };
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
  /** TB family (E16): screening numbers over the films that ran without error. */
  tb?: TbSummary | null;
  /** E17: the same numbers per split (tuning films were seen while tuning the lung cutoff and prompts). */
  tbBySplit?: { heldOut: TbSummary | null; tuning: TbSummary | null } | null;
  /** E17: the vLLM release the GPU image pins (gpu/Dockerfile). */
  vllm?: string | null;
  published: boolean;
}

/** E16 · TB screening per run. Intervals are 95% Wilson; rates are null when nothing applies. */
export interface TbSummary {
  /** E17: the TB set the films came from, or "mixed". */
  dataset?: TbDataset | "mixed" | null;
  n: number;
  /** TB films flagged (tb_flag passed) over TB films. */
  sensitivity: number | null;
  /** Normal films not flagged over normal films. */
  specificity: number | null;
  sensitivityCi: [number, number] | null;
  specificityCi: [number, number] | null;
  /** TB films sent urgent or higher after the pattern lift. */
  floorRate: number | null;
  /** TB films with a zone to match whose outline matched it. */
  zoneMatchRate: number | null;
  /** Films whose clinician-facing text never named TB. */
  noLeakRate: number | null;
}
