import { describe, expect, it } from "vitest";

import { mockDraft } from "../src/models/fixtures";
import { FindingsSchema, IntakeSchema, PatientSummaryRewriteSchema, TriageSchema, toResponseJsonSchema } from "../src/schemas/study";

describe("schemas", () => {
  it("accept a well-formed intake answer and reject a bad decision or view", () => {
    const ok = IntakeSchema.safeParse({
      decision: "accept",
      quality: { ok: true, issues: [] },
      looksMedical: true,
      modality: "xray",
      studyType: "Chest X-ray",
      view: "PA",
    });
    expect(ok.success).toBe(true);
    const bad = IntakeSchema.safeParse({
      decision: "maybe",
      quality: { ok: true, issues: [] },
      looksMedical: true,
      modality: "xray",
      studyType: "x",
      view: "oblique",
    });
    expect(bad.success).toBe(false);
  });

  it("accept a triage answer and reject an unknown priority", () => {
    const base = { evidence: ["lung_area_asymmetry"], rationale: "Left field smaller." };
    expect(TriageSchema.safeParse({ ...base, priority: "urgent" }).success).toBe(true);
    expect(TriageSchema.safeParse({ ...base, priority: "stat" }).success).toBe(false);
  });

  it("accept a findings answer shaped like the model output", () => {
    const parsed = FindingsSchema.safeParse({
      findings: [
        { title: "Right lower lobe opacity", description: "Patchy opacity.", confidence: 91, box_2d: [550, 580, 750, 840], shape: "ellipse" },
        { title: "No pneumothorax", description: "Lung edges visible.", confidence: 80, box_2d: null, shape: "rect" },
      ],
      clinicianSummary: {
        findings: "Right lower lobe opacity. No pneumothorax.",
        impression: ["Consolidation."],
        recommendation: "Correlate clinically.",
        highlights: [{ findingIndex: 0, quote: "Right lower lobe opacity" }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("reject more than six findings", () => {
    const f = { title: "t", description: "d", confidence: 1, box_2d: null, shape: "rect" };
    const parsed = FindingsSchema.safeParse({
      findings: Array(7).fill(f),
      clinicianSummary: { findings: "x", impression: ["y"], recommendation: "z", highlights: [] },
    });
    expect(parsed.success).toBe(false);
  });

  it("accept a patient rewrite with one plain step per signed sentence, and refuse a string", () => {
    expect(PatientSummaryRewriteSchema.safeParse({ body: "Your X-ray looks clear.", nextSteps: ["No more tests are needed."] }).success).toBe(true);
    expect(PatientSummaryRewriteSchema.safeParse({ body: "Clear.", nextSteps: "No more tests." }).success).toBe(false);
  });
});

describe("toResponseJsonSchema", () => {
  it("emits plain JSON Schema without zod's $schema or additionalProperties", () => {
    const json = JSON.stringify(toResponseJsonSchema(FindingsSchema));
    expect(json).not.toContain("$schema");
    expect(json).not.toContain("additionalProperties");
    const obj = toResponseJsonSchema(IntakeSchema) as { type: string; required: string[]; properties: Record<string, unknown> };
    expect(obj.type).toBe("object");
    expect(obj.required).toEqual(expect.arrayContaining(["decision", "quality", "looksMedical", "modality", "studyType", "view"]));
    expect(Object.keys(obj.properties)).toContain("quality");
  });
});
