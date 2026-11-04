/**
 * E1 · Builds the task library from the fetched NIH films
 * (`data/out/eval/films.json`, from `data/fetch_demo_samples.py --eval`).
 * Pure: the CLI (`scripts/eval.ts build-tasks`) writes the result to
 * `eval/tasks/<family>/<id>.json`, which is committed; the images are not.
 */
import { createHash } from "node:crypto";

import { parseLocation } from "../lib/location";
import { intakeCriteria, noteCriteria, prepCriteria, tbCriteria, triageCriteria } from "./grade";
import type { EvalTask, IntakeVariant, Lane, TbDataset } from "./types";

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
    tags: ["Faithful rewrite", film?.nihLabel ? `NIH label: ${film.nihLabel}` : "Synthetic report"],
    split: "held-out",
    film,
    context: { age: null, sex: null, indication: "", synthetic: true },
    expected: {},
    signed,
    criteria: noteCriteria(),
  };
}

// ---- E16 · TB screening (Shenzhen and Montgomery sets) ----------------------

/** One entry of `data/out/eval/tb-films.json` (from `data/fetch_tb_sets.py --eval`). */
export interface TbFilm {
  id: string;
  dataset: TbDataset;
  label: "tb" | "normal";
  split: EvalTask["split"];
  /** The clinical reading; read here for the side and zone, never committed. */
  reading: string;
  age: number | null;
  sex: string | null;
  /** Consensus ROI boxes, normalised 0–1 [x0, y0, x1, y1]; empty when none. */
  roi: [number, number, number, number][];
  source: string;
}

/**
 * The fetcher's fixed-seed sample (`pick` in data/fetch_tb_sets.py): the n ids
 * with the smallest sha256("seed:id"). Same ids for the same seed, in any order.
 */
export function pick(ids: readonly string[], n: number, seed: string): string[] {
  const key = new Map(ids.map((id) => [id, createHash("sha256").update(`${seed}:${id}`).digest("hex")]));
  return [...ids].sort((a, b) => (key.get(a)! < key.get(b)! ? -1 : key.get(a)! > key.get(b)! ? 1 : 0)).slice(0, n);
}

/** The Montgomery readings' shorthand, spelled out so `parseLocation` can read it. */
const SHORTHAND: [RegExp, string][] = [
  [/\bRUL\b/g, "right upper"],
  [/\bRML\b/g, "right middle"],
  [/\bRLL\b/g, "right lower"],
  [/\bLUL\b/g, "left upper"],
  [/\bLLL\b/g, "left lower"],
  [/\b(lingula|lungula)\b/gi, "left"],
  [/\brt\b/gi, "right"],
  [/\blt\b/gi, "left"],
];

/** Side and zone named by a clinical reading; null when it names no side ("STB", "inactive TB scars"). */
export function readingZone(reading: string): NonNullable<EvalTask["expected"]["zone"]> | null {
  const text = SHORTHAND.reduce((t, [re, to]) => t.replace(re, to), reading);
  const loc = parseLocation(text);
  return loc.sides.length ? { sides: loc.sides, zone: loc.zone } : null;
}

/** Neutral and the same for every film, so it gives nothing away. */
export const TB_INDICATION = "Adult with a cough for several weeks.";
const DATASET_LABEL: Record<TbDataset, string> = { shenzhen: "Shenzhen set", montgomery: "Montgomery set" };

/**
 * TB family tasks, one per film. Ordered by split (held-out first), then by a
 * seeded hash, so the task number says nothing about the label. The reading
 * text stays out of the task (the NLM readme asks that the set not be
 * shared); only the side and zone read from it are kept.
 */
export function buildTbTasks(films: readonly TbFilm[]): EvalTask[] {
  const order = new Map(pick(films.map((f) => f.id), films.length, "heliodx-e16:order").map((id, i) => [id, i]));
  const sorted = [...films].sort((a, b) => (a.split === b.split ? order.get(a.id)! - order.get(b.id)! : a.split === "held-out" ? -1 : 1));
  return sorted.map((film, i): EvalTask => {
    const zone = film.label === "tb" ? readingZone(film.reading) : null;
    const roi = film.label === "tb" ? film.roi : [];
    return {
      id: `tb-${i + 1}`,
      title: `Screening film ${i + 1}`,
      family: "tb",
      tags: [film.label === "tb" ? "Expected pattern of concern" : "Expected no pattern of concern", DATASET_LABEL[film.dataset]],
      split: film.split,
      film: { id: film.id, source: film.source, dataset: film.dataset, label: film.label, roi },
      context: { age: film.age, sex: film.sex, indication: TB_INDICATION, synthetic: true },
      expected: { tbSuggestive: film.label === "tb", ...(zone ? { zone } : {}) },
      criteria: tbCriteria(film.label, !!zone || roi.length > 0),
    };
  });
}
