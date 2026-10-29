/**
 * What the model must return at each step, as zod schemas. The same schemas
 * produce the JSON Schema sent as `responseJsonSchema`, so validation and
 * the request contract cannot drift apart.
 */
import { z } from "zod";

export const ModalitySchema = z.enum(["xray", "ct_mri", "ultrasound", "lab", "skin"]);

/** B11 intake: accept or ask for a retake, and what the image shows. */
export const IntakeSchema = z.object({
  decision: z.enum(["accept", "retake"]).describe("retake when the image cannot be read reliably as it is."),
  // No score: Glimmer returned 0 on every live run, even when accepting.
  // The score is computed in code from the measured quality (tools/quality.ts).
  quality: z.object({
    ok: z.boolean().describe("True when the image is sharp, well lit and complete enough to read."),
    issues: z.array(z.string().max(80)).max(6).describe("Short problems, e.g. 'motion blur', 'glare on film'. Empty when ok."),
  }),
  looksMedical: z.boolean().describe("True when the image is a medical image or report of any kind."),
  modality: ModalitySchema.describe("The modality the image actually shows."),
  studyType: z.string().min(1).max(60).describe("Specific study name, e.g. 'Chest X-ray', 'Knee X-ray', 'Skin lesion photo'."),
  view: z.enum(["PA", "AP", "lateral", "other", "unknown"]).describe("Projection for radiographs; 'other' or 'unknown' otherwise."),
});
export type IntakeDraft = z.infer<typeof IntakeSchema>;

/**
 * B11 triage: priority from measurements, with the ids it rests on.
 * No `confidence` field: on the live GPU, Glimmer looped on whitespace after
 * `"confidence":` in 3 of 5 runs (up to the token cap, ~108 s). Without the
 * field, 5 of 5 runs returned valid JSON in under 100 tokens. Confidence is
 * set in code (stages/triage.ts).
 */
export const TriageSchema = z.object({
  priority: z.enum(["routine", "urgent", "critical"]),
  evidence: z.array(z.string().max(40)).max(8).describe("Ids of the measurements or masks this priority rests on, exactly as given."),
  rationale: z.string().min(1).max(300).describe("At most two sentences; observations only, no diagnosis."),
});
export type TriageDraft = z.infer<typeof TriageSchema>;


// An array with length 4 rather than a tuple: many structured-output
// implementations reject tuple-style `items: [...]`.
export const Box2dSchema = z
  .array(z.number())
  .length(4)
  .describe("Bounding box as [ymin, xmin, ymax, xmax] on a 0–1000 scale, or null when the finding has no single location.");

/** Step 3: findings plus the clinician summary, in one reasoning call. */
export const FindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(80).describe("Short observation, e.g. 'Right lower lobe opacity'."),
        description: z.string().min(1).max(400).describe("One or two sentences describing what is seen and where."),
        confidence: z.number().int().min(0).max(100).describe("How confident the observation is, 0–100."),
        box_2d: Box2dSchema.nullable(),
        shape: z.enum(["ellipse", "rect"]).describe("ellipse for soft/diffuse findings, rect for discrete objects or text regions."),
      }),
    )
    .max(6)
    .describe("Up to six observations, most clinically relevant first. Empty when nothing notable is seen."),
  clinicianSummary: z.object({
    findings: z.string().min(1).max(1200).describe("Prose findings paragraph quoting each finding title verbatim."),
    impression: z.array(z.string().max(200)).min(1).max(5),
    recommendation: z.string().min(1).max(400),
    highlights: z
      .array(
        z.object({
          findingIndex: z.number().int().min(0).max(5),
          quote: z.string().min(1).max(120).describe("Exact substring of `findings` that refers to this finding."),
        }),
      )
      .max(6),
  }),
});
export type FindingsDraft = z.infer<typeof FindingsSchema>;

/**
 * B12 prep: proposed observations, each citing evidence ids from the
 * catalogue in the prompt. No enums or free numbers here: Glimmer looped on
 * whitespace before an enum value in triage, and returned 0 for free
 * integers in intake. Ids and regions are validated in code.
 */
export const PrepSchema = z.object({
  proposed: z
    .array(
      z.object({
        title: z.string().min(1).max(80).describe("Short observation, e.g. 'Lung fields symmetric in size'."),
        description: z.string().min(1).max(300).describe("One or two sentences: what is seen, where, with the measured value if one applies."),
        evidence: z.array(z.string().max(40)).min(1).max(4).describe("Ids from the evidence list this observation rests on, exactly as given."),
        region: z.string().max(40).describe("A region id from the list, or 'none'."),
      }),
    )
    .min(1)
    .max(6),
  clinicianSummary: FindingsSchema.shape.clinicianSummary,
});
export type PrepDraft = z.infer<typeof PrepSchema>;

/** The clinician summary alone, for regeneration from reviewed findings (text-only call). */
export const ClinicianSummarySchema = FindingsSchema.shape.clinicianSummary;
export type ClinicianSummaryDraft = z.infer<typeof ClinicianSummarySchema>;

/** Step 4: plain-language summary for the patient. */
/**
 * B16 · The model's plain-language rewrite of the SIGNED report. Minimal on
 * purpose (guided decoding on Glimmer): title, attribution, mapping and
 * reading level are decided in code (lib/patientSummary.ts).
 */
export const PatientSummaryRewriteSchema = z.object({
  body: z.string().min(1).max(900),
  nextSteps: z.array(z.string().min(1).max(300)).max(8),
});
export type PatientSummaryRewriteDraft = z.infer<typeof PatientSummaryRewriteSchema>;

/**
 * JSON Schema for the model's structured output. The metadata zod adds
 * (`$schema`, `additionalProperties`) is stripped so a stricter validator on
 * the model side never rejects the request.
 */
export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
  return strip(json) as Record<string, unknown>;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema" || k === "additionalProperties" || k === "additionalItems") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}
