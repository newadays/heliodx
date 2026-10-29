import { describe, expect, it } from "vitest";

import type { Study, TraceEntry } from "@/types/study";

import { buildTimeline, caseId, formatCost, slaLabel } from "./caseTimeline";

const ts = (ms: number) => ({ toMillis: () => ms });
const T0 = 1_800_000_000_000;

function study(over: Partial<Study> = {}): Study {
  return {
    id: "abc123xyz",
    orgId: "demo",
    clinicianUid: "u",
    clinicianName: "Dr. Demo Clinician",
    patient: { name: "Sample Patient 1" },
    modality: "xray",
    studyType: "Chest X-ray (PA)",
    clinicalContext: "",
    source: "sample",
    image: { storagePath: "", thumbPath: null, width: 0, height: 0, bytes: 0, contentType: "image/jpeg" },
    status: "shared",
    priority: "critical",
    demo: { sampleId: "s1", age: 34, sex: "F", indication: "Cough for two weeks." },
    pipeline: {
      runId: "r",
      stepTimestamps: {
        quality_check: ts(T0 + 5_000),
        classifying: ts(T0 + 20_000),
        detecting: ts(T0 + 30_000),
        ready: ts(T0 + 45_000),
        patient_summary_ready: ts(T0 + 200_000),
      },
    },
    findings: [
      { id: "f1", status: "accepted" },
      { id: "f2", status: "edited" },
    ] as never,
    measurements: [{ id: "density_ratio" }] as never,
    clinicianSummary: null,
    patientSummary: { nextSteps: [{ text: "x", mapsTo: 0, confirmed: true }] } as never,
    reviewHash: null,
    signed: { by: "u", name: "Dr. Demo Clinician", at: ts(T0 + 120_000), device: null, reportHash: "sha256:x", reviewHash: "r", impressionConfirmed: true },
    shares: [{ id: "s", channel: "pdf", target: "", sentAt: ts(T0 + 300_000), consent: { given: true, note: "", by: "u", at: ts(T0) } }],
    deletedAt: null,
    createdAt: ts(T0),
    updatedAt: ts(T0),
    ...over,
  } as Study;
}

const ev = (seq: number, stage: string, over: Partial<TraceEntry> = {}): TraceEntry => ({ id: `t${seq}`, at: ts(T0 + seq), seq, stage, kind: "tool", name: "x", ok: true, ...over });

const trace: TraceEntry[] = [
  ev(1, "quality_check", { kind: "model", name: "glimmer.chat", model: "glimmer", ms: 3000, promptTokens: 1000, outputTokens: 240 }),
  ev(2, "quality_check", { name: "segment_region", model: "sam-3.1", ms: 900, ok: true }),
  ev(3, "quality_check", { name: "segment_region", model: "sam-3.1", ok: false }),
  ev(4, "quality_check", { kind: "check", name: "measure_quality", result: "pass · sharpness 58.8" }),
  ev(5, "classifying", { kind: "check", name: "compare_density", result: "L/R density ratio 1.31 · threshold 1.25 · exceeded (flag)" }),
  ev(6, "classifying", { kind: "check", name: "measure_ratio", result: "CTR 0.44 · threshold 0.55 · within limits" }),
  ev(7, "detecting", { name: "render_overlay" }),
  ev(8, "patient_summary", { kind: "check", name: "map_next_steps", result: "1 step(s) mapped to signed sentences · 0 from signed text · grade 5.1" }),
];

describe("buildTimeline", () => {
  it("builds every stage of a shared case, with agents, models, durations, tokens and lines", () => {
    const rows = buildTimeline(study(), trace, T0 + 400_000);
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ["received", "done"],
      ["intake", "done"],
      ["triage", "critical"],
      ["prep", "done"],
      ["signed", "human"],
      ["summary", "done"],
      ["shared", "human"],
    ]);
    const intake = rows[1];
    expect(intake.models).toEqual(["Glimmer", "SAM 3.1"]);
    expect(intake.ms).toBe(15_000);
    expect(intake.tokens).toBe(1240);
    expect(intake.line).toBe("Quality pass · sharpness 58.8. 1/2 regions segmented");
    expect(rows[0].line).toBe("Chest X-ray · PA · 34 F · from sample");
    expect(rows[0].agent).toBe("Sample");
    expect(rows[2].line).toBe("Priority critical. L/R density ratio 1.31 · threshold 1.25 exceeded; CTR 0.44 within limits");
    expect(rows[3].line).toBe("Draft ready: 2 proposed observations, 1 measurement, 1 overlay.");
    expect(rows[4].line).toBe("1 accepted, 1 edited, 0 rejected. Signed by Dr. Demo Clinician.");
    expect(rows[4].models).toEqual([]);
    expect(rows[5].line).toContain("mapped to signed sentences");
    expect(rows[6].line).toBe("1 share · PDF · consent recorded");
  });

  it("greys out stages not reached, shows the running stage, and the failed stage", () => {
    const running = buildTimeline(study({ status: "classifying", priority: undefined, signed: undefined, shares: [], pipeline: { runId: "r", stepTimestamps: { quality_check: ts(T0), classifying: ts(T0 + 10_000) } } }), trace, T0 + 25_000);
    expect(running.map((r) => r.state)).toEqual(["done", "done", "running", "pending", "pending", "pending", "pending"]);
    expect(running[2].line).toBe("In progress for 15 s.");
    expect(running[4].line).toBe("Waiting for the clinician to review and sign.");
    expect(running[4].at).toBe(0);

    const failed = buildTimeline(study({ status: "failed", priority: undefined, signed: undefined, shares: [], pipeline: { runId: "r", stepTimestamps: { quality_check: ts(T0) }, error: { code: "quality_rejected", message: "", at: "quality_check" } } }), [], T0);
    expect(failed[1]).toMatchObject({ state: "failed", line: "Stopped: quality_rejected." });
    expect(failed[2].state).toBe("pending");
  });
});

describe("helpers", () => {
  it("formats cost, case id and SLA", () => {
    expect(formatCost(9400, 3180)).toBe("9.4 s · 3 180 tok");
    expect(formatCost(900, 0)).toBe("900 ms");
    expect(formatCost(null, 0)).toBe("");
    expect(caseId("abc123xyz")).toBe("CABC12");
    const s = study({ status: "ready" });
    expect(slaLabel(s, T0 + 30_000 + 72_000)).toEqual({ text: "critical · 3:48 left", level: "critical" });
    expect(slaLabel(s, T0 + 30_000 + 6 * 60_000)?.text).toBe("critical · 1:00 over");
    expect(slaLabel(study(), T0)).toBeNull();
  });
});
