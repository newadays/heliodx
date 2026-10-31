/**
 * E1 · Builds the task library from the fetched NIH films
 * (`data/out/eval/films.json`, from `data/fetch_demo_samples.py --eval`).
 * Pure: the CLI (`scripts/eval.ts build-tasks`) writes the result to
 * `eval/tasks/<family>/<id>.json`, which is committed; the images are not.
 */
import { intakeCriteria, noteCriteria, prepCriteria, triageCriteria } from "./grade";
import type { EvalTask, IntakeVariant, Lane } from "./types";

export interface Film {
  id: string;
  nihLabel: string;
  age: number;
  sex: string;
  demo: boolean;
  source: { dataset: string; split: string; rowIdx: number; nih: string };
}

/**
 * Ground truth lane from the NIH label. NIH labels carry no size, so an
 * effusion is urgent, never critical; mass and consolidation have no
 * measurement behind them and are expected to be missed by geometry alone.
 */
export const LANE_FOR_LABEL: Record<string, Lane> = {
  Pneumothorax: "critical",
  Cardiomegaly: "urgent",
  Effusion: "urgent",
  Mass: "urgent",
  Consolidation: "urgent",
  "No Finding": "routine",
};

/** Neutral indications, assigned by position so they give nothing away. */
const INDICATIONS = [
  "Cough for two weeks.",
  "Shortness of breath on exertion.",
  "Pre-operative check.",
  "Chest pain after a fall.",
  "Fever and cough for three days.",
  "Follow-up film.",
  "Sudden breathlessness.",
  "Routine check.",
];

/** How many films get the intake variants, and how many non-medical images. */
export const INTAKE_FILMS = 4;
export const NON_MEDICAL = 2;
const VARIANTS: IntakeVariant[] = ["clean", "blur", "lowres"];
const VARIANT_TITLE: Record<IntakeVariant, string> = {
  clean: "Clean copy",
  blur: "Blurred copy",
  lowres: "Down-sampled copy",
  nonmedical: "Non-medical image",
};

const split = (i: number): EvalTask["split"] => (i % 2 === 0 ? "tuning" : "held-out");

export function buildTasks(films: Film[]): EvalTask[] {
  const tasks: EvalTask[] = [];
  films.forEach((film, i) => {
    const n = i + 1;
    const lane = LANE_FOR_LABEL[film.nihLabel];
    if (!lane) throw new Error(`No lane for NIH label ${film.nihLabel}`);
    const base = {
      split: split(i),
      film: { id: film.id, nihLabel: film.nihLabel, rowIdx: film.source.rowIdx, source: film.source.nih },
      context: { age: film.age, sex: film.sex, indication: INDICATIONS[i % INDICATIONS.length], synthetic: true as const },
    };
    const label = `NIH label: ${film.nihLabel}`;
    if (i < INTAKE_FILMS) {
      for (const variant of VARIANTS) {
        tasks.push({
          ...base,
          id: `intake-${variant}-${n}`,
          title: `${VARIANT_TITLE[variant]} of film ${n}`,
          family: "intake",
          tags: [variant === "clean" ? "Accept" : "Retake", label],
          variant,
          expected: variant === "clean" ? { retake: false, modality: "xray", view: "PA", chest: true } : { retake: true },
          criteria: intakeCriteria(variant),
        });
      }
    }
    tasks.push({
      ...base,
      id: `triage-${n}`,
      title: `Reading lane for film ${n}`,
      family: "triage",
      tags: [`Expected ${lane}`, label],
      expected: { lane },
      criteria: triageCriteria(lane),
    });
    const polarity = film.nihLabel === "No Finding" ? "normal" : "attention";
    tasks.push({
      ...base,
      id: `prep-${n}`,
      title: `Observations for film ${n}`,
      family: "prep",
      tags: [polarity === "normal" ? "Expected normal" : "Expected attention", label],
      expected: { polarity },
      criteria: prepCriteria(polarity),
    });
  });
  for (let k = 1; k <= NON_MEDICAL; k++) {
    tasks.push({
      id: `intake-nonmedical-${k}`,
      title: `${VARIANT_TITLE.nonmedical} ${k}`,
      family: "intake",
      tags: ["Retake", "Synthetic image"],
      split: split(k),
      film: null,
      variant: "nonmedical",
      context: { age: null, sex: null, indication: "Routine check.", synthetic: true },
      expected: { retake: true, notMedical: true },
      criteria: intakeCriteria("nonmedical"),
    });
  }
  return tasks;
}

/** Patient-note tasks from signed texts (built by `scripts/eval.ts build-notes`). */
export function noteTask(n: number, film: EvalTask["film"], signed: NonNullable<EvalTask["signed"]>): EvalTask {
  return {
    id: `note-${n}`,
    title: `Patient note from signed report ${n}`,
    family: "note",
    tags: ["Faithful rewrite", film ? `NIH label: ${film.nihLabel}` : "Synthetic report"],
    split: "held-out",
    film,
    context: { age: null, sex: null, indication: "", synthetic: true },
    expected: {},
    signed,
    criteria: noteCriteria(),
  };
}
