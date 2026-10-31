/**
 * E2 · Runs one task through the real stage code (`runIntake`, `runTriage`,
 * `runPrep`, `writePatientNote`) against one system. The only thing that
 * differs between systems is `generate`, bound by the CLI to the `clinical`
 * route (HelioDX: Glimmer) or the baseline route (MedGemma). SAM masks come
 * from one cached segmenter, so both systems measure the same lungs.
 *
 * Nothing is written to Firestore or Storage: masks stay in memory, overlays
 * are not rendered, and the trace is captured in memory for latency, tokens
 * and the model's raw answer.
 */
import { writePatientNote, rewriterWith } from "../callables/generatePatientSummary";
import { decodeRle } from "../models/gpu";
import type { generateJson } from "../models/client";
import { stripFences } from "../models/client";
import { recommendationSentences, type PatientRewrite } from "../lib/patientSummary";
import { traceCapture, type CapturedEvent } from "../lib/trace";
import { stripConditionSentences } from "../lib/vocabulary";
import { runIntake } from "../stages/intake";
import { runPrep } from "../stages/prep";
import { runTriage } from "../stages/triage";
import type { MaskRecord, Segmenter } from "../tools/segment";
import { gradeError, gradeIntake, gradeNote, gradePrep, gradeTriage, scoreOf, type IntakeOutcome, type NoteOutcome, type PrepOutcome, type TriageOutcome } from "./grade";
import { taskImage } from "./images";
import type { CriterionResult, EvalResult, EvalSystem, EvalTask } from "./types";

export interface RunDeps {
  system: EvalSystem;
  model: string;
  generate: typeof generateJson;
  segment: Segmenter;
  loadFilm: (filmId: string) => Promise<Buffer>;
  gpuUsdPerHour: number;
}

/** The fallback impression line in `runPrep` when every model line was removed. */
const FALLBACK_IMPRESSION = "See the observations above.";

function rawAnswer(events: CapturedEvent[], step: string): Record<string, unknown> | null {
  const e = [...events].reverse().find((x) => x.kind === "model" && x.ok && (x.args as { step?: string } | undefined)?.step === step);
  if (!e?.detail?.raw) return null;
  try {
    return JSON.parse(stripFences(e.detail.raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runTask(task: EvalTask, deps: RunDeps): Promise<EvalResult> {
  const events: CapturedEvent[] = [];
  const started = Date.now();
  let criteria: CriterionResult[];
  let output: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    ({ criteria, output } = await traceCapture(task.family, (e) => events.push(e), () => runFamily(task, deps, events)));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    criteria = gradeError(task, error);
  }
  const latencyMs = Date.now() - started;
  const calls = events.filter((e) => e.kind === "model");
  return {
    taskId: task.id,
    family: task.family,
    title: task.title,
    tags: task.tags,
    split: task.split,
    system: deps.system,
    model: deps.model,
    score: scoreOf(criteria),
    criteria,
    output,
    latencyMs,
    modelMs: calls.reduce((n, e) => n + (e.ms ?? 0), 0),
    modelCalls: calls.length,
    tokensIn: calls.reduce((n, e) => n + (e.promptTokens ?? 0), 0),
    tokensOut: calls.reduce((n, e) => n + (e.outputTokens ?? 0), 0),
    costUsd: Math.round((latencyMs / 3_600_000) * deps.gpuUsdPerHour * 10_000) / 10_000,
    error,
  };
}

async function runFamily(task: EvalTask, deps: RunDeps, events: CapturedEvent[]): Promise<{ criteria: CriterionResult[]; output: Record<string, unknown> }> {
  if (task.family === "note") return runNote(task, deps);

  const nonMedicalIndex = Number(/(\d+)$/.exec(task.id)?.[1] ?? 1);
  const film = task.film ? await deps.loadFilm(task.film.id) : null;
  const image = await taskImage(film, task.variant, nonMedicalIndex);
  const masksByPath = new Map<string, string>();
  const studyPrefix = `eval/${task.id}`;
  const common = { bucket: "eval", studyPrefix };

  const intake = await runIntake(
    { ...common, image, modalityHint: "xray", clinicalContext: task.context.indication, step: "quality_check" },
    { generate: deps.generate, segment: deps.segment, saveMask: async (path, json) => void masksByPath.set(path, json) },
  );
  if (task.family === "intake") {
    const out: IntakeOutcome = { retake: intake.retake, issues: intake.quality.issues, warnings: intake.quality.warnings, modality: intake.modality, view: intake.view, chest: intake.chest };
    return { criteria: gradeIntake(task, out), output: { ...out, qualityScore: intake.quality.score } };
  }
  if (intake.retake) throw new Error(`intake sent the film back: ${intake.quality.issues.join("; ")}`);
  if (!intake.chest) throw new Error("intake did not confirm a chest X-ray (lungs not found)");

  const loadMask = async (_bucket: string, rec: MaskRecord) => {
    const json = masksByPath.get(rec.path);
    if (!json) throw new Error(`mask ${rec.maskId} missing`);
    const { rle, width, height } = JSON.parse(json) as { rle: number[]; width: number; height: number };
    return decodeRle(rle, height, width);
  };
  const saveOverlay = async (_bucket: string, prefix: string, rec: MaskRecord) => `${prefix}/overlays/${rec.maskId}.png`;
  const triage = await runTriage(
    { ...common, image, masks: intake.masks, chest: intake.chest, samError: intake.samError, studyType: intake.studyType, view: intake.view, step: "classifying" },
    { generate: deps.generate, loadMask, saveOverlay },
  );
  const allowed = [...triage.measurements.map((m) => m.id as string), ...intake.masks.map((m) => m.maskId)];
  const flagged = triage.flags.map((f) => f.measurementId as string);
  if (task.family === "triage") {
    const raw = rawAnswer(events, "classifying");
    const out: TriageOutcome = {
      priority: triage.priority,
      floor: triage.floor,
      cited: Array.isArray(raw?.evidence) ? (raw.evidence as string[]) : triage.evidence,
      allowed,
      needsHuman: triage.needsHuman,
      flags: flagged,
      rationale: stripConditionSentences(triage.rationale ?? ""),
    };
    return {
      criteria: gradeTriage(task, out),
      output: {
        priority: out.priority,
        floor: out.floor,
        cited: out.cited,
        flags: flagged,
        rationale: out.rationale,
        measurements: triage.measurements.map((m) => ({ id: m.id, value: m.value })),
      },
    };
  }

  const prep = await runPrep(
    {
      ...common,
      image,
      studyType: intake.studyType,
      clinicalContext: task.context.indication,
      masks: intake.masks,
      measurements: triage.measurements,
      flags: triage.flags,
      heartBox: triage.heartBox,
      overlays: triage.overlays,
      step: "detecting",
    },
    { generate: deps.generate, saveOverlay },
  );
  const raw = rawAnswer(events, "detecting");
  const out: PrepOutcome = {
    findings: prep.findings.map((f) => ({ title: f.title, description: f.description, evidence: f.evidence })),
    flagged,
    dropped: prep.dropped,
    proposed: Array.isArray(raw?.proposed) ? (raw.proposed as unknown[]).length : prep.findings.length + prep.dropped.conditions + prep.dropped.noEvidence,
    impression: prep.clinicianSummary.impression,
    impressionFallback: prep.clinicianSummary.impression.length === 1 && prep.clinicianSummary.impression[0] === FALLBACK_IMPRESSION,
    recommendation: prep.clinicianSummary.recommendation,
  };
  return {
    criteria: gradePrep(task, out),
    output: {
      findings: out.findings.map((f) => ({ title: f.title, description: f.description, evidence: [...f.evidence.measurementIds, ...f.evidence.maskIds] })),
      flagged,
      dropped: out.dropped,
      proposed: out.proposed,
      summary: { findings: prep.clinicianSummary.findings, impression: out.impression, recommendation: out.recommendation, studyType: intake.studyType },
    },
  };
}

async function runNote(task: EvalTask, deps: RunDeps): Promise<{ criteria: CriterionResult[]; output: Record<string, unknown> }> {
  if (!task.signed) throw new Error("note task has no signed text");
  const signed = task.signed;
  const sentences = recommendationSentences(signed.recommendation);
  const candidates: PatientRewrite[] = [];
  const base = rewriterWith(deps.generate);
  const note = await writePatientNote({
    signed,
    sentences,
    rewrite: async (...args) => {
      const r = await base(...args);
      candidates.push(r);
      return r;
    },
    signer: "Eval signer",
    simulated: true,
    reportHash: `eval:${task.id}`,
  });
  const out: NoteOutcome = {
    sentences,
    impression: signed.impression,
    first: candidates[0],
    firstGrade: note.firstCheck.grade,
    firstOk: note.firstCheck.ok,
    attempts: note.attempts,
    flagged: note.flagged,
    readingGrade: note.summary.readingGrade,
  };
  return {
    criteria: gradeNote(task, out),
    output: { body: note.summary.body, nextSteps: note.summary.nextSteps.map((s) => s.text), readingGrade: note.summary.readingGrade, attempts: note.attempts, flagged: note.flagged },
  };
}
