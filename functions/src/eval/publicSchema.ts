/**
 * E17 · The public results file: what `npm run eval -- export` writes to
 * Cloud Storage and the results site (E18, `site/`) reads. Zod only, no
 * Firebase, so the site imports it as is.
 *
 * Built by `buildPublicResults` (publicResults.ts) from local run records.
 * It never carries film ids, file names, clinical readings, ages, sexes,
 * images, ROI boxes, prompts or raw model text: tasks are named by their
 * library id and title ("tb-37", "TB screening · film 37") only.
 */
import { z } from "zod";

import { EVAL_FAMILIES } from "./types";

export const PUBLIC_RESULTS_VERSION = 1;
export const PUBLIC_SYSTEMS = ["helio", "medgemma"] as const;

const rate = z.number().min(0).max(1).nullable();
const interval = z.tuple([z.number(), z.number()]).nullable();
const SystemId = z.enum(PUBLIC_SYSTEMS);
const FamilyId = z.enum(EVAL_FAMILIES);
const perSystem = <T extends z.ZodTypeAny>(v: T) => z.object({ helio: v.optional(), medgemma: v.optional() });

export const PublicTbSummarySchema = z.object({
  dataset: z.string().nullable(),
  n: z.number().int().nonnegative(),
  sensitivity: rate,
  specificity: rate,
  sensitivityCi: interval,
  specificityCi: interval,
  floorRate: rate,
  zoneMatchRate: rate,
  noLeakRate: rate,
});

const FamilySummarySchema = z.object({
  tasks: z.number().int().nonnegative(),
  meanScore: z.number(),
  passRate: z.number(),
  medianLatencyMs: z.number(),
  costPerTaskUsd: z.number(),
});

export const PublicResultsSchema = z.object({
  version: z.literal(PUBLIC_RESULTS_VERSION),
  generatedAt: z.string(),
  systems: z.array(
    z.object({
      id: SystemId,
      label: z.string(),
      model: z.string(),
      precision: z.string(),
      gpu: z.string(),
      vllm: z.string().nullable(),
      runIds: z.array(z.string()),
      commits: z.array(z.string()),
      tasks: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
      costUsd: z.number(),
      wallMinutes: z.number(),
    }),
  ),
  families: z.array(
    z.object({
      id: FamilyId,
      label: z.string(),
      perSystem: perSystem(z.object({ runId: z.string(), commit: z.string(), startedAt: z.string(), summary: FamilySummarySchema })),
    }),
  ),
  triage: perSystem(
    z.object({ criticalRecall: rate, abnormalRecall: rate, overTriage: rate, floorAbnormalRecall: rate }),
  ).nullable(),
  tb: z
    .object({
      dataset: z.object({ id: z.string(), name: z.string(), tb: z.number().int(), normal: z.number().int(), citation: z.string(), terms: z.string() }),
      perSystem: perSystem(
        z.object({
          combined: PublicTbSummarySchema,
          heldOut: PublicTbSummarySchema.nullable(),
          tuning: PublicTbSummarySchema.nullable(),
          criteriaRates: z.record(z.string(), rate),
        }),
      ),
    })
    .nullable(),
  tasks: z.array(
    z.object({
      id: z.string(),
      family: FamilyId,
      title: z.string(),
      split: z.enum(["tuning", "held-out"]),
      tags: z.array(z.string()),
      criteria: z.array(z.object({ id: z.string(), label: z.string(), method: z.enum(["deterministic", "agent", "clinician"]) })),
      inputs: z.object({ indication: z.string().nullable(), variant: z.string().nullable() }),
      /** What the task expects, in words: "TB", "Normal", "Urgent or higher", "Retake: blurred"… */
      expected: z.string().nullable(),
      perSystem: perSystem(
        z.object({
          runId: z.string(),
          score: z.number(),
          criteria: z.record(z.string(), z.boolean().nullable()),
          latencyMs: z.number(),
          /** A short class only ("lungs not found", "output cut off"), never the raw message. */
          error: z.string().nullable(),
        }),
      ),
    }),
  ),
  limits: z.array(z.string()),
  attribution: z.array(z.string()),
});

export type PublicResults = z.infer<typeof PublicResultsSchema>;
export type PublicTask = PublicResults["tasks"][number];
export type PublicTbSummary = z.infer<typeof PublicTbSummarySchema>;
export type PublicSystemId = (typeof PUBLIC_SYSTEMS)[number];
