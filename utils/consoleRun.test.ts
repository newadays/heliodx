import { describe, expect, it } from "vitest";

import type { Study, TraceEntry } from "@/types/study";

import { agentStatus, callsByTool, clock, consoleSteps, CONSOLE_AGENTS, runIdOf, runStats, runStatusOf, seconds, thin } from "./consoleRun";

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


describe("consoleSteps", () => {
  it("projects the stage rows into console steps: kind, tool calls, checks and the tool-call count on model steps", () => {
    const steps = consoleSteps(study(), trace, T0 + 400_000);
    expect(steps.map((s) => [s.key, s.kind])).toEqual([
      ["received", "system"],
      ["intake", "model"],
      ["triage", "model"],
      ["prep", "model"],
      ["signed", "clinician"],
      ["summary", "model"],
      ["shared", "clinician"],
    ]);
    const intake = steps[1];
    expect(intake.calls.map((c) => c.name)).toEqual(["segment_region", "segment_region", "measure_quality"]);
    expect([intake.checksPassed, intake.checksFailed]).toEqual([1, 0]);
    expect(intake.summary).toMatch(/· 3 tool calls$/);
    expect(steps[5].title).toBe("Patient note");
  });

  it("counts a failed check, and a model call is never a tool call", () => {
    const failing = [...trace, ev(9, "patient_summary", { kind: "check", name: "check_patient_summary", ok: false })];
    const steps = consoleSteps(study(), failing, T0 + 400_000);
    expect(steps[5].checksFailed).toBe(1);
    expect(steps[5].recovered).toEqual({});
    expect(steps.flatMap((s) => s.calls).some((c) => c.name.endsWith(".chat"))).toBe(false);
  });
});

describe("recovered checks", () => {
  it("a failed check followed by a passing one in the same step was retried, not failed (the note check at grade 9.6)", () => {
    const retried = [
      ev(20, "patient_summary", { kind: "check", name: "check_patient_summary", ok: false, result: "retry · grade 9.6" }),
      ev(21, "patient_summary", { kind: "check", name: "map_next_steps", ok: true }),
    ];
    const step = consoleSteps(study(), retried, T0 + 400_000)[5];
    expect([step.checksPassed, step.checksFailed]).toEqual([1, 0]);
    expect(step.recovered).toEqual({ t20: "retried" });
  });

  it("a failed check with nothing after it stays failed (a quality stop)", () => {
    const stopped = [ev(30, "quality_check", { kind: "check", name: "measure_quality", ok: false })];
    expect(consoleSteps(study({ status: "failed", pipeline: { runId: "r", stepTimestamps: {}, error: { code: "quality_rejected", message: "x", at: "quality_check" } } } as never), stopped, T0 + 10_000)[1].checksFailed).toBe(1);
  });
});

describe("recovered checks across runs", () => {
  it("orders by time, not seq (seq restarts per run), and labels a clinician override", () => {
    // Run 1 stops at seq 6; the warm re-run's override also lands at seq 6, a minute later.
    const runs = [
      ev(6, "quality_check", { kind: "check", name: "measure_quality", ok: false, at: ts(T0 + 1_000) }),
      ev(6, "quality_check", { id: "o6", kind: "check", name: "quality_override", ok: true, at: ts(T0 + 61_000) }),
    ];
    const step = consoleSteps(study(), runs, T0 + 400_000)[1];
    expect(step.recovered).toEqual({ t6: "overridden" });
    expect(step.checksFailed).toBe(0);
  });

  it("a passing check of an unrelated tool is not a recovery", () => {
    const unrelated = [
      ev(40, "quality_check", { kind: "check", name: "measure_quality", ok: false }),
      ev(41, "quality_check", { kind: "check", name: "wait_for_gpu", ok: true }),
    ];
    expect(consoleSteps(study(), unrelated, T0 + 400_000)[1].checksFailed).toBe(1);
  });
});

describe("runStats", () => {
  it("equals what the steps contain, so the tiles match an export", () => {
    const steps = consoleSteps(study(), trace, T0 + 400_000);
    const stats = runStats(study(), steps, T0 + 400_000);
    // Model steps only, so the tile equals the rows' "· N tool calls".
    expect(stats.toolCalls).toBe(steps.filter((s) => s.kind === "model" && s.state !== "pending").reduce((n, s) => n + s.calls.length, 0));
    expect(stats.toolCalls).toBe(7);
    expect(stats.agentTokens).toBe(1240);
    expect(stats.observations).toBe(2);
    expect([stats.checksPassed, stats.checksFailed]).toEqual([4, 0]);
    expect(stats.clinicianSteps).toBe(2);
    expect(stats.arrivalToSharedMs).toBe(300_000);
    expect(stats.arrivalToNowMs).toBeNull();
    expect(stats.modelCalls).toBe(1);
    expect(stats.status).toBe("shared");
  });

  it("counts arrival to now while the run is open", () => {
    const open = study({ status: "ready", shares: [], signed: null } as never);
    const stats = runStats(open, consoleSteps(open, trace, T0 + 60_000), T0 + 60_000);
    expect(stats.arrivalToSharedMs).toBeNull();
    expect(stats.arrivalToNowMs).toBe(60_000);
    expect(stats.status).toBe("awaiting_review");
  });

  it("a failed run has no ticking arrival clock", () => {
    const failed = study({ status: "failed", shares: [], signed: null, pipeline: { runId: "r", stepTimestamps: {}, error: { code: "quality_rejected", message: "x", at: "quality_check" } } } as never);
    expect(runStats(failed, consoleSteps(failed, trace, T0 + 60_000), T0 + 60_000).arrivalToNowMs).toBeNull();
  });
});

describe("run helpers", () => {
  it("names runs, maps statuses, counts calls per tool and agent status", () => {
    expect(runIdOf(study({ caseId: "S-AI2Y7" } as never))).toBe(`run-${new Date(T0).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}-s-ai2y7`);
    expect(runIdOf(study({ caseId: "" } as never))).toMatch(/-cabc12$/);
    expect(runStatusOf(study({ status: "detecting" } as never))).toBe("running");
    expect(runStatusOf(study({ status: "failed" } as never))).toBe("failed");
    const steps = consoleSteps(study(), trace, T0 + 400_000);
    expect(callsByTool(steps)).toMatchObject({ segment_region: 2, measure_quality: 1, render_overlay: 1, map_next_steps: 1 });
    expect(agentStatus(CONSOLE_AGENTS[0], steps)).toBe("ran");
    const early = study({ status: "classifying", shares: [], signed: null } as never);
    expect(agentStatus(CONSOLE_AGENTS[3], consoleSteps(early, trace, T0 + 25_000))).toBe("idle");
  });

  it("formats numbers the way the spec shows them", () => {
    expect(thin(7720)).toBe("7,720");
    expect(seconds(31_900)).toBe("31.9 s");
    expect(seconds(831)).toBe("831 ms");
    expect(clock(1_461_000)).toBe("24:21 mins");
    expect(clock(3_726_000)).toBe("1:02:06 hrs");
  });
});
