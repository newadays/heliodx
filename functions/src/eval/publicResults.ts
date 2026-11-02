/**
 * E17 · Builds the public results file (publicSchema.ts) from local run
 * records. Pure: the CLI (`npm run eval -- export`) reads the runs and the
 * task library and writes the file.
 *
 * Per system and family the newest run that has the family wins, so one file
 * can hold the NIH families from one run and the TB family from another; each
 * family keeps its own run id and commit. Per-task TB rows carry the library
 * id, title, split, tags and the film-level label only (decision 2026-11-02);
 * film ids, readings, ages, sexes, ROI boxes and model text never leave.
 */
import { latestFamilyRuns } from "./summary";
import { PUBLIC_RESULTS_VERSION, PUBLIC_SYSTEMS, PublicResultsSchema, type PublicResults, type PublicSystemId, type PublicTask, type PublicTbSummary } from "./publicSchema";
import { EVAL_FAMILIES, FAMILY_LABEL, type EvalResult, type EvalRun, type EvalTask, type TbSummary } from "./types";

export interface LocalRun {
  run: EvalRun;
  results: EvalResult[];
}

/** Copied verbatim from eval/README.md (a test keeps them in step). */
export const LIMITS = [
  "NIH labels are text-mined and noisy, and carry no size: an effusion is graded urgent, never critical.",
  "Triage floors come from geometry (heart size, lung asymmetry, angle blunting, density). Mass and consolidation have no measurement behind them, so they are expected to be missed unless the model raises the lane.",
  "The prompts were written for Glimmer. MedGemma runs them unchanged, so some of its misses may be about following our format rather than reading the film.",
  "These are screening sets from two sites, not the clinic's own population, equipment or TB prevalence. A sensitivity here does not transfer.",
  "The language model is a general model, not a trained TB detector. The number says whether the agents surface the pattern for a clinician to consider, not how well a film is diagnosed.",
  "Labels are film-level (TB yes/no). The zone check is coarse: thirds of the chest from the lung masks, matched to a side and zone parsed from a free-text reading (Montgomery shorthand such as RUL, LUL, rt, lt is spelled out first), or any overlap with an ROI box. No lesion-level accuracy is claimed.",
];

const NIH_CITATION =
  "Wang X, Peng Y, Lu L, Lu Z, Bagheri M, Summers RM. *ChestX-ray8: Hospital-scale Chest X-ray Database and Benchmarks on Weakly-Supervised Classification and Localization of Common Thorax Diseases.* IEEE CVPR 2017.";
const TB_CITATION =
  "Cite: Jaeger S, Candemir S, Antani S, Wáng YX, Lu PX, Thoma G. *Two public chest X-ray datasets for computer-aided screening of pulmonary diseases.* Quant Imaging Med Surg 2014;4(6):475–477. Candemir S, Jaeger S, Palaniappan K, et al. *Lung segmentation in chest radiographs using anatomical atlases with nonrigid registration.* IEEE Trans Med Imaging 2014;33(2):577–590. Jaeger S, Karargyris A, Candemir S, et al. *Automatic tuberculosis screening using chest radiographs.* IEEE Trans Med Imaging 2014;33(2):233–245. Data courtesy of the U.S. National Library of Medicine, Shenzhen No. 3 People's Hospital, and the Montgomery County Department of Health and Human Services.";
const TB_TERMS =
  "Please do not share the dataset outside of your research group/ organization, but forward new dataset requests to us. Please inform us if you find errors or inconsistencies in the data. It is requested that publications resulting from the use of this data attribute the source (National Library of Medicine, National Institutes of Health, Bethesda, MD, USA and Shenzhen No.3 People's Hospital, Guangdong Medical College, Shenzhen, China) and cite the following publications:";
const LICENCE = "MedGemma is used under the Health AI Developer Foundations terms of use and is not for clinical use. HelioDX is a research prototype and is not for clinical use either.";

export const ATTRIBUTION = [NIH_CITATION, TB_CITATION, LICENCE];
export const README_QUOTES = [...LIMITS, NIH_CITATION, TB_CITATION, TB_TERMS, LICENCE];

const DATASET_NAME: Record<string, string> = {
  shenzhen: "Shenzhen chest X-ray set (U.S. National Library of Medicine)",
  montgomery: "Montgomery County chest X-ray set (U.S. National Library of Medicine)",
  mixed: "Shenzhen and Montgomery County chest X-ray sets (U.S. National Library of Medicine)",
};

const LANE_TEXT = { routine: "Routine", urgent: "Urgent or higher", critical: "Critical" } as const;

/** What the task expects, in words; null when there is no single expected value (patient note). */
export function expectedText(task: EvalTask): string | null {
  const e = task.expected;
  switch (task.family) {
    case "tb":
      return (e.tbSuggestive ?? task.film?.label === "tb") ? "TB film" : "Normal film";
    case "triage":
      return e.lane ? LANE_TEXT[e.lane] : null;
    case "prep":
      return e.polarity === "attention" ? "Attention" : e.polarity === "normal" ? "Normal" : null;
    case "intake":
      if (e.notMedical) return "Not a medical image: retake";
      return e.retake ? `Retake${e.blockingReason ? `: ${e.blockingReason}` : ""}` : "Accepted";
    default:
      return null;
  }
}

/** A short class for a task error; the raw message can quote model output, so it never leaves. */
export function errorClass(error: string | null): string | null {
  if (!error) return null;
  if (/lungs not found/i.test(error)) return "Lungs not found at intake";
  if (/sent the film back/i.test(error)) return "Sent back at intake";
  if (/truncated/i.test(error)) return "Answer cut off at the length limit";
  if (/failed validation|not JSON/i.test(error)) return "Answer did not match the schema";
  if (/did not answer in time|unavailable|fetch failed|ECONNRESET|socket hang up/i.test(error)) return "GPU unavailable";
  return "Error";
}

const strip = (t: TbSummary): PublicTbSummary => ({
  dataset: t.dataset ?? null,
  n: t.n,
  sensitivity: t.sensitivity,
  specificity: t.specificity,
  sensitivityCi: t.sensitivityCi,
  specificityCi: t.specificityCi,
  floorRate: t.floorRate,
  zoneMatchRate: t.zoneMatchRate,
  noLeakRate: t.noLeakRate,
});

export function buildPublicResults(input: { runs: LocalRun[]; tasks: EvalTask[]; vllm: string | null; generatedAt: string }): PublicResults {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const newestFirst = [...input.runs].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  const systems: PublicResults["systems"] = [];
  const families: PublicResults["families"] = EVAL_FAMILIES.map((id) => ({ id, label: FAMILY_LABEL[id], perSystem: {} }));
  const rows = new Map<string, PublicTask>();
  let triage: PublicResults["triage"] = null;
  let tb: PublicResults["tb"] = null;

  for (const system of PUBLIC_SYSTEMS) {
    const mine = newestFirst.filter((r) => r.run.system === system);
    if (!mine.length) continue;
    const picked = latestFamilyRuns(mine.map((r) => r.run));
    const used = new Map<string, LocalRun>();
    const included: EvalResult[] = [];
    for (const family of EVAL_FAMILIES) {
      const run = picked[family];
      if (!run) continue;
      const local = mine.find((r) => r.run.id === run.id)!;
      used.set(run.id, local);
      families.find((f) => f.id === family)!.perSystem[system] = { runId: run.id, commit: run.commit, startedAt: run.startedAt, summary: run.summary[family]! };
      for (const r of local.results.filter((x) => x.family === family)) {
        const task = taskById.get(r.taskId);
        if (!task) continue;
        included.push(r);
        const row = rows.get(r.taskId) ?? {
          id: task.id,
          family: task.family,
          title: task.title,
          split: task.split,
          tags: task.tags,
          criteria: task.criteria.map((c) => ({ id: c.id, label: c.label, method: c.method })),
          inputs: { indication: task.family === "note" ? null : task.context.indication, variant: task.variant ?? null },
          expected: expectedText(task),
          perSystem: {},
        };
        row.perSystem[system as PublicSystemId] = {
          runId: run.id,
          score: r.score,
          criteria: Object.fromEntries(r.criteria.map((c) => [c.id, c.pass])),
          latencyMs: r.latencyMs,
          error: errorClass(r.error),
        };
        rows.set(r.taskId, row);
      }
      if (family === "triage" && run.triage) triage = { ...(triage ?? {}), [system]: run.triage };
      if (family === "tb" && run.tb) {
        const ran = local.results.filter((r) => r.family === "tb" && !r.error);
        const ids = [...new Set(ran.flatMap((r) => r.criteria.map((c) => c.id)))];
        const criteriaRates = Object.fromEntries(
          ids.map((id) => {
            const graded = ran.map((r) => r.criteria.find((c) => c.id === id)?.pass).filter((p): p is boolean => p === true || p === false);
            return [id, graded.length ? Math.round((graded.filter(Boolean).length / graded.length) * 10_000) / 10_000 : null];
          }),
        );
        const tbTasks = local.results.filter((r) => r.family === "tb").map((r) => taskById.get(r.taskId)).filter((t): t is EvalTask => !!t);
        const dataset = run.tb.dataset ?? "mixed";
        // Widened: TS narrows the outer `let` to null inside the loop.
        const prev = tb as PublicResults["tb"];
        tb = {
          dataset: prev?.dataset ?? {
            id: dataset,
            name: DATASET_NAME[dataset] ?? DATASET_NAME.mixed,
            tb: tbTasks.filter((t) => t.expected.tbSuggestive).length,
            normal: tbTasks.filter((t) => t.expected.tbSuggestive === false).length,
            citation: TB_CITATION,
            terms: TB_TERMS,
          },
          perSystem: {
            ...(prev?.perSystem ?? {}),
            [system]: {
              combined: strip(run.tb),
              heldOut: run.tbBySplit?.heldOut ? strip(run.tbBySplit.heldOut) : null,
              tuning: run.tbBySplit?.tuning ? strip(run.tbBySplit.tuning) : null,
              criteriaRates,
            },
          },
        };
      }
    }
    const runs = [...used.values()].map((r) => r.run);
    const first = runs[0];
    systems.push({
      id: system,
      label: first.label,
      model: first.model,
      precision: first.precision,
      gpu: first.gpu,
      vllm: first.vllm ?? input.vllm,
      runIds: runs.map((r) => r.id),
      commits: [...new Set(runs.map((r) => r.commit))],
      tasks: included.length,
      errors: included.filter((r) => r.error).length,
      costUsd: Math.round(included.reduce((n, r) => n + r.costUsd, 0) * 100) / 100,
      wallMinutes: Math.round(runs.reduce((n, r) => n + (Date.parse(r.finishedAt) - Date.parse(r.startedAt)), 0) / 60_000),
    });
  }

  return PublicResultsSchema.parse({
    version: PUBLIC_RESULTS_VERSION,
    generatedAt: input.generatedAt,
    systems,
    families: families.filter((f) => Object.keys(f.perSystem).length),
    triage,
    tb,
    tasks: [...rows.values()].sort(
      (a, b) => EVAL_FAMILIES.indexOf(a.family) - EVAL_FAMILIES.indexOf(b.family) || a.id.localeCompare(b.id, undefined, { numeric: true }),
    ),
    limits: LIMITS,
    attribution: ATTRIBUTION,
  });
}
