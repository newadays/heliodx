import { describe, expect, it } from "vitest";

import type { Finding, Study } from "@/types/study";

import { analysisProgress, caseIdOf, defaultStep, findingView, patientOf, studyLabel, verdict, viewStatus } from "./model";

const ts = (ms: number) => ({ toMillis: () => ms });

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    index: 0,
    title: "Cardiac silhouette within expected limits",
    description: "The heart is within expected size.",
    confidence: 90,
    region: { shape: "ellipse", x: 0.4, y: 0.5, w: 0.2, h: 0.1 },
    color: "#000",
    status: "pending",
    reviewedAt: null,
    evidence: { measurementIds: ["cardiothoracic_ratio"], maskIds: [] },
    ...over,
  };
}

function study(over: Partial<Study> = {}): Study {
  return {
    id: "abcDEF123",
    orgId: "demo",
    clinicianUid: "u",
    clinicianName: "Dr. Demo",
    patient: { name: "Sample Patient 1" },
    modality: "xray",
    studyType: "Chest X-ray (PA)",
    clinicalContext: "Cough for two weeks.",
    source: "sample",
    image: { storagePath: "x", thumbPath: null, width: 1024, height: 1024, bytes: 1, contentType: "image/jpeg" },
    status: "ready",
    pipeline: { runId: null, stepTimestamps: {} },
    demo: { sampleId: "s", age: 34, sex: "M", indication: "Cough for two weeks." },
    measurements: [{ id: "cardiothoracic_ratio", value: 0.4509, maskIds: [] }],
    findings: [finding()],
    clinicianSummary: null,
    patientSummary: null,
    reviewHash: null,
    shares: [],
    deletedAt: null,
    createdAt: ts(1000),
    updatedAt: ts(1000),
    ...over,
  };
}

describe("model", () => {
  it("projects identity and labels", () => {
    expect(caseIdOf(study())).toBe("CABCDE");
    expect(caseIdOf(study({ caseId: "AI2Y7" }))).toBe("AI2Y7");
    expect(patientOf(study())).toMatchObject({ firstName: "Sample", ageSex: "34 M" });
    expect(patientOf(study({ source: "upload", patient: { name: "Upload 3 · 28 Oct" }, demo: undefined, details: { age: 47, sex: "F", indication: null, view: null } }))).toMatchObject({ firstName: "Upload 3 · 28 Oct", ageSex: "47 F" });
    expect(studyLabel(study())).toBe("Chest X-ray · PA");
    expect(studyLabel(study({ view: "AP" }))).toBe("Chest X-ray · AP");
  });

  it("maps statuses and steps", () => {
    expect(viewStatus(study({ status: "detecting" }))).toBe("analyzing");
    expect(viewStatus(study())).toBe("draft_ready");
    expect(viewStatus(study({ findings: [finding({ status: "accepted" })] }))).toBe("in_review");
    expect(viewStatus(study({ status: "patient_summary_ready" }))).toBe("signed");
    expect(viewStatus(study({ status: "shared" }))).toBe("shared");
    expect(defaultStep(study({ status: "classifying" }))).toBe("analyzing");
    expect(defaultStep(study())).toBe("review");
    expect(defaultStep(study({ status: "signed" }))).toBe("share");
    expect(defaultStep(study({ status: "shared" }))).toBe("done");
  });

  it("builds evidence, band, polarity and markers", () => {
    const f = findingView(finding(), study());
    expect(f).toMatchObject({ n: 1, evidence: "Cardiothoracic ratio 0.45 · limit 0.55", band: "high", polarity: "normal" });
    expect(f.regions[0].x).toBeCloseTo(50);
    expect(f.regions[0].y).toBeCloseTo(55);
    const flagged = findingView(finding(), study({ triage: { flags: [{ measurementId: "cardiothoracic_ratio", level: "urgent", value: 0.6, threshold: 0.55 }] } as never }));
    expect(flagged.polarity).toBe("attention");
    expect(findingView(finding({ evidence: { measurementIds: [], maskIds: ["m"] } }), study()).evidence).toBe("The heart is within expected size.");
    expect(findingView(finding({ regions: [{ x: 0.17, y: 0.79 }, { x: 0.84, y: 0.79 }] }), study()).regions).toHaveLength(2);
  });

  it("says the verdict", () => {
    expect(verdict([{ polarity: "normal" }, { polarity: "normal" }]).text).toBe("2 findings · all within normal limits");
    expect(verdict([{ polarity: "attention" }, { polarity: "normal" }]).text).toBe("2 findings · 1 needs attention");
  });

  it("moves the progress bar by stage and streamed findings", () => {
    expect(analysisProgress(study({ status: "queued" }))).toBe(10);
    expect(analysisProgress(study({ status: "quality_check" }))).toBe(30);
    expect(analysisProgress(study({ status: "detecting", findings: [], analysis: {} }))).toBe(45);
    expect(analysisProgress(study({ status: "detecting", analysis: { expectedFindings: 2 } }))).toBe(73);
    expect(analysisProgress(study())).toBe(100);
  });
});
