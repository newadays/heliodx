/**
 * The study pipeline: quality check → classify → detect → summarize.
 *
 * `runPipeline` owns the status walk, idempotency and failure record. The
 * draft itself comes from either the fixtures (MODEL_MOCK=1) or three
 * calls to the Meta Model API. Logs carry ids, steps and codes
 * only: no patient data, no prompt or response text.
 */
import type { DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { MODEL_MOCK, MODELS } from "../config";
import { generateJson } from "../models/client";
import { mockDraft, type DraftSummaries, type Modality, type MockDraft } from "../models/fixtures";
import { findingsPrompt } from "../models/prompts";
import { FindingsSchema } from "../schemas/study";
import { resolveHighlights, toFindings } from "./convert";
import { StudyWriter } from "../study/writer";
import { WrongStateError } from "../study/stateMachine";
import { PipelineError, type PipelineStatus } from "./errors";
import { isTransient, isWarmingWait } from "./retryPolicy";
import { runIntake, type IntakeOutput } from "../stages/intake";
import { runPrep } from "../stages/prep";
import { runTriage, type TriageOutput } from "../stages/triage";
import { gpuHealth } from "../models/gpu";
import { prepareImages } from "./image";
import { setTraceStage, traceEvent, traceScope } from "../lib/trace";
import { describeMeasurement, describeQuality, measurementTool } from "../lib/traceText";
import { uniqueCaseId } from "../lib/caseId";
import { describeUpload, type UploadMeta } from "../lib/uploads";
import { expectedAnalysisMs, recordAnalysisRun } from "../lib/analysisStats";
import { ctrOverlays, findingFields } from "../lib/findingFields";
import { studyDirOf } from "../lib/storagePaths";
import { acceptAllHash } from "../lib/reviewHash";

export { PipelineError } from "./errors";

/** Minimal view of the study document the pipeline reads. */
export interface StudyForPipeline {
  status: PipelineStatus;
  modality: Modality;
  clinicianName?: string;
  clinicalContext?: string;
  image?: { storagePath?: string };
  /** `qualityOverride`: the clinician chose "Analyze anyway" after a quality rejection. */
  pipeline?: { runId?: string | null; qualityOverride?: { by?: string } | null };
  createdAt?: { toMillis(): number } | null;
  orgId?: string;
  caseId?: string;
  upload?: UploadMeta;
}

/** A cold private GPU: the run stops before any model call and waits in the queue. */
class ModelsWarming extends PipelineError {}

/** How long a run waits in place for a cold GPU before going back to the queue (the trigger allows 300 s). */
export const WARM_WAIT_MS = 170_000;
const WARM_POLL_MS = 8_000;

/**
 * Whether this event should run the pipeline. Pure, unit-tested.
 *  - already ran for this event (retry/redelivery) → no
 *  - study already past the hand-off → no (a second upload does not re-draft)
 */
export function shouldStart(study: StudyForPipeline | null, eventId: string): { start: boolean; reason: string } {
  if (!study) return { start: false, reason: "study_missing" };
  if (study.pipeline?.runId === eventId) return { start: false, reason: "duplicate_event" };
  if (study.status !== "uploading" && study.status !== "queued") {
    return { start: false, reason: `status_${study.status}` };
  }
  return { start: true, reason: "ok" };
}

/** Delay between mock steps so the app's stepper visibly advances. */
const MOCK_STEP_MS = Number(process.env.MODEL_MOCK_STEP_MS ?? 1200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunOptions {
  mock?: boolean;
  /** Storage bucket holding the original; required for the real path. */
  bucket?: string;
  /** Test seam. */
  stepDelayMs?: number;
}

/** Everything a step needs to write; produced incrementally by the real path. */
interface Stage1 {
  quality: { ok: boolean; score: number; issues: string[] };
  studyType: string;
  modality: Modality;
  image?: { width: number; height: number; bytes: number; thumbPath: string };
}

export async function runPipeline(
  ref: DocumentReference,
  study: StudyForPipeline,
  eventId: string,
  opts: RunOptions = {},
): Promise<void> {
  // B19: everything below records into studies/{id}/trace.
  return traceScope(ref, "quality_check", () => runPipelineTraced(ref, study, eventId, opts));
}

async function runPipelineTraced(
  ref: DocumentReference,
  study: StudyForPipeline,
  eventId: string,
  opts: RunOptions,
): Promise<void> {
  const mock = opts.mock ?? MODEL_MOCK;
  const delay = opts.stepDelayMs ?? (mock ? MOCK_STEP_MS : 0);
  const studyId = ref.id;
  const reviewedBy = study.clinicianName ?? "Your clinician";
  const clinicalContext = (study.clinicalContext ?? "").trim();

  const writer = new StudyWriter(ref, "pipeline", eventId);
  const setStatus = async (status: PipelineStatus, extra: Record<string, unknown> = {}) => {
    await writer.advance(status, extra);
    setTraceStage(status);
    logger.info("pipeline step", { studyId, step: status });
  };

  // Claim the study and enter quality_check in one transaction, so a
  // redelivered or racing event sees the claim and stops.
  const claim = await writer.claim();
  if (!claim.started) {
    logger.info("pipeline skipped", { studyId, reason: claim.reason });
    return;
  }
  logger.info("pipeline step", { studyId, step: "quality_check" });
  // §4.10: what the browser removed or redacted, and any override, on the Received step.
  if (study.upload) {
    traceEvent({
      kind: "check",
      name: "receive_upload",
      stage: "received",
      ok: true,
      args: { format: study.upload.format, removedTags: study.upload.removedTags, redactions: study.upload.redactions?.length ?? 0, overrides: study.upload.overrides ?? [] },
      result: describeUpload(study.upload),
    });
  }

  let at: PipelineStatus = "quality_check";
  const studyPrefix = studyDirOf(studyId, study);
  let intake: IntakeOutput | null = null;
  try {
    // ---- 1 + 2: quality and study type ------------------------------------
    let fixture: MockDraft | null = null;
    let image: Awaited<ReturnType<typeof prepareImages>> | null = null;
    let stage1: Stage1;

    if (!mock) {
      // Check the private GPU first with a short timeout. A cold service
      // (scaled to zero) answers 503 or not at all while it loads; this
      // request is also what makes Cloud Run start it. Waiting does not use
      // up an attempt (retryPolicy.isWarmingWait).
      let health = await gpuHealth(8_000);
      if (health.glimmer === "not_configured") {
        throw new PipelineError("model_unavailable", "The private model service is not configured.", at);
      }
      // A cold GPU: wait here, checking every few seconds, so the case keeps
      // its place and the clinician sees it waiting (pipeline.warming), rather
      // than going back to the queue at once. Past the wait budget it is
      // requeued as before and the sweeper picks it up.
      if (health.glimmer !== "ok" || health.sam !== "ok") {
        const since = Date.now();
        // Keep the first wait's start across requeues, so the clock the clinician sees never resets.
        const firstSince = (study.pipeline as { warming?: { since?: { toMillis(): number } } } | undefined)?.warming?.since?.toMillis?.() ?? since;
        await writer.patch({ "pipeline.warming": { since: new Date(firstSince), glimmer: health.glimmer, sam: health.sam } }, { allowedIn: ["quality_check"] });
        while ((health.glimmer !== "ok" || health.sam !== "ok") && Date.now() - since < WARM_WAIT_MS) {
          await sleep(WARM_POLL_MS);
          health = await gpuHealth(8_000);
        }
        if (health.glimmer !== "ok" || health.sam !== "ok") {
          throw new ModelsWarming("model_unavailable", "The private model service is starting.", at);
        }
        await writer.patch({ "pipeline.warming.readyAt": new Date(), "pipeline.warming.waitedMs": Date.now() - since }, { allowedIn: ["quality_check"] });
        traceEvent({ kind: "check", name: "wait_for_gpu", ok: true, ms: Date.now() - since, args: {}, result: `private GPU ready after ${Math.round((Date.now() - since) / 1000)} s` });
      }
    }

    if (mock) {
      if (delay) await sleep(delay);
      // Test seam for the retry path: simulate the private model service
      // being down. Mock mode only; never read on the real path.
      const forced = process.env.MODEL_MOCK_FAIL;
      if (forced === "model_unavailable" || forced === "timeout") {
        throw new PipelineError(forced, "Simulated model service failure (MODEL_MOCK_FAIL).", at);
      }
      fixture = mockDraft(study.modality, reviewedBy);
      stage1 = { quality: fixture.quality, studyType: fixture.studyType, modality: study.modality };
      // Test seam: a quality rejection, for the "Analyze anyway" path.
      if (forced === "quality_rejected") stage1.quality = { ...fixture.quality, ok: false, issues: ["Image looks blurred."] };
      traceEvent({ kind: "model", name: "mock.chat", model: "mock", route: "clinical", ms: delay, ok: true, args: { step: "quality_check" }, result: "fixture quality and study type (MODEL_MOCK)", detail: { prompt: "(MODEL_MOCK) Check image quality and confirm the study type.", raw: JSON.stringify({ quality: fixture.quality, studyType: fixture.studyType }) } });
    } else {
      if (!opts.bucket || !study.image?.storagePath) {
        throw new PipelineError("internal", "Study has no image path.", at);
      }
      image = await prepareImages(opts.bucket, study.image.storagePath);
      // B11 intake: code quality metrics + one Glimmer call + SAM lungs.
      intake = await runIntake({
        image: image.model.data,
        modalityHint: study.modality,
        clinicalContext,
        bucket: opts.bucket,
        studyPrefix,
        step: at,
      });
      stage1 = {
        quality: intake.quality,
        studyType: intake.studyType,
        modality: intake.modality,
        image: { ...image.original, thumbPath: image.thumbPath },
      };
      traceEvent({
        kind: "check",
        name: "measure_quality",
        args: { view: intake.view },
        ok: intake.quality.ok,
        result: describeQuality(intake.metrics, intake.quality.ok),
      });
    }

    const imagePatch = stage1.image
      ? {
          "image.width": stage1.image.width,
          "image.height": stage1.image.height,
          "image.bytes": stage1.image.bytes,
          "image.thumbPath": stage1.image.thumbPath,
        }
      : {};
    const intakePatch = intake
      ? {
          "pipeline.qualityMetrics": intake.metrics,
          "pipeline.intake": { view: intake.view, chest: intake.chest, samError: intake.samError },
          "pipeline.masks": intake.masks,
          ...(intake.retake ? { "flags.needsRetake": true } : {}),
        }
      : {};
    // B21: a readable case id for studies created without one (app uploads).
    const casePatch = study.caseId ? {} : { caseId: await uniqueCaseId(ref.firestore, study.orgId ?? "unknown", (study as { source?: string }).source === "sample" ? "sample" : "upload") };
    // B22: how long analysis usually takes here, for the progress display.
    const expectedMs = await expectedAnalysisMs(ref.firestore, study.orgId ?? "unknown").catch(() => null);
    await writer.patch(
      { "pipeline.quality": stage1.quality, ...imagePatch, ...intakePatch, ...casePatch, ...(expectedMs ? { "analysis.expectedMs": expectedMs } : {}) },
      { allowedIn: ["quality_check"] },
    );

    if (!stage1.quality.ok && study.pipeline?.qualityOverride) {
      traceEvent({ kind: "check", name: "quality_override", ok: true, args: {}, result: `clinician chose to analyze anyway · ${stage1.quality.issues.join("; ").slice(0, 160)}` });
    } else if (!stage1.quality.ok) {
      throw new PipelineError(
        "quality_rejected",
        stage1.quality.issues.join("; ") || "Image quality too low to read.",
        at,
      );
    }

    at = "classifying";
    const view = intake ? (intake.view === "PA" || intake.view === "AP" ? intake.view : null) : /\((PA|AP)\)/.exec(stage1.studyType)?.[1] ?? null;
    await setStatus("classifying", { studyType: stage1.studyType, modality: stage1.modality, view });
    if (delay) await sleep(delay);

    // ---- B11 triage: measurements, overlays, priority ------------------------
    let triageFields: Record<string, unknown>;
    let triage: TriageOutput | null = null;
    if (intake) {
      triage = await runTriage({
        image: image!.model.data,
        masks: intake.masks,
        chest: intake.chest,
        samError: intake.samError,
        studyType: intake.studyType,
        view: intake.view,
        bucket: opts.bucket!,
        studyPrefix,
        step: at,
      });
      triageFields = {
        priority: triage.priority,
        triage: {
          priority: triage.priority,
          floor: triage.floor,
          evidence: triage.evidence,
          rationale: triage.rationale,
          confidence: triage.confidence,
          flags: triage.flags,
          heartBox: triage.heartBox,
        },
        measurements: triage.measurements,
        "pipeline.overlays": triage.overlays,
        "flags.degraded": triage.degraded,
        "flags.needsHuman": triage.needsHuman,
      };
      logger.info("pipeline triage", { studyId, priority: triage.priority, floor: triage.floor, flags: triage.flags.length });
      for (const m of triage.measurements) {
        traceEvent({
          kind: "check",
          name: measurementTool(m.id),
          args: { measurement: m.id, masks: m.maskIds },
          ok: true,
          result: describeMeasurement(m, triage.flags),
        });
      }
      for (const rec of intake.masks) {
        const overlayPath = triage.overlays[rec.maskId];
        if (overlayPath) traceEvent({ kind: "tool", name: "render_overlay", args: { label: rec.label, mask: rec.maskId }, ok: true, result: "overlay saved", overlayPath });
      }
      traceEvent({
        kind: "check",
        name: "set_priority",
        args: { priority: triage.priority, floor: triage.floor },
        ok: true,
        result: `priority ${triage.priority} (floor ${triage.floor} from measurements)${triage.needsHuman ? " · needs a human read" : ""}`,
      });
    } else {
      triageFields = {
        priority: "routine",
        triage: { priority: "routine", floor: "routine", evidence: [], rationale: "Mock triage.", confidence: "high", flags: [], heartBox: null },
        measurements: [],
      };
    }

    // ---- 3: findings + clinician summary ----------------------------------
    at = "detecting";
    await setStatus("detecting", triageFields);
    let findings;
    let clinicianSummary: DraftSummaries["clinicianSummary"];
    if (fixture) {
      if (delay) await sleep(delay);
      findings = fixture.findings;
      clinicianSummary = fixture.summaries.clinicianSummary;
      traceEvent({ kind: "model", name: "mock.chat", model: "mock", route: "clinical", ms: delay, ok: true, args: { step: "detecting" }, result: `${findings.length} fixture observations (MODEL_MOCK)`, detail: { prompt: "(MODEL_MOCK) Propose evidence-backed observations.", raw: JSON.stringify({ proposed: findings.map((f) => ({ title: f.title, description: f.description })) }) } });
    } else if (intake?.chest && triage && triage.measurements.length) {
      // B12: evidence-backed observations on the SAM lung masks.
      const prep = await runPrep({
        image: image!.model.data,
        studyType: stage1.studyType,
        clinicalContext,
        masks: intake.masks,
        measurements: triage.measurements,
        flags: triage.flags,
        heartBox: triage.heartBox,
        overlays: triage.overlays,
        bucket: opts.bucket!,
        studyPrefix,
        step: at,
      });
      findings = prep.findings;
      clinicianSummary = prep.clinicianSummary;
      logger.info("pipeline prep", { studyId, findings: findings.length, ...prep.dropped });
      traceEvent({
        kind: "check",
        name: "propose_observations",
        args: { measurements: triage.measurements.length },
        ok: true,
        result: `${findings.length} observations with evidence · dropped ${prep.dropped.conditions} naming a condition, ${prep.dropped.noEvidence} without evidence`,
      });
    } else {
      // Other studies (non-chest, or no masks): the model's own regions.
      const draft = await generateJson({
        route: "clinical",
        schema: FindingsSchema,
        prompt: findingsPrompt(stage1.studyType, stage1.modality, clinicalContext),
        image: { mimeType: image!.model.mimeType, data: image!.model.data },
        step: at,
        answerTokens: 6144,
        reasoningEffort: "medium",
      });
      findings = toFindings(draft.findings);
      clinicianSummary = {
        findings: draft.clinicianSummary.findings.trim(),
        impression: draft.clinicianSummary.impression.map((s) => s.trim()).filter(Boolean),
        recommendation: draft.clinicianSummary.recommendation.trim(),
        highlights: resolveHighlights(draft.clinicianSummary.findings.trim(), findings, draft.clinicianSummary.highlights),
        generatedFromReviewHash: null,
        editedByClinician: false,
      };
    }
    // B21: evidence line, polarity and marker positions stored with each
    // finding, and the CTR widths for the viewer.
    const fieldCtx = {
      measurements: triage?.measurements ?? [],
      flags: triage?.flags ?? [],
      masks: intake?.masks ?? [],
    };
    findings = findings.map((f) => ({ ...f, ...findingFields(f, fieldCtx) }));
    const ctr = triage?.measurements.find((m) => m.id === "cardiothoracic_ratio")?.value ?? null;
    const overlays = ctrOverlays(triage?.ctrLines ?? null, ctr, findings);
    // B22: findings land one by one as they are checked, so the Analyzing
    // step fills in as it goes; the clinician can open Review before ready.
    await writer.patch({ overlays, "analysis.expectedFindings": findings.length }, { allowedIn: ["detecting"] });
    for (let i = 1; i <= findings.length; i++) {
      await writer.patch({ findings: findings.slice(0, i) }, { allowedIn: ["detecting"] });
    }

    // ---- 4: summaries ready ---------------------------------------------------
    // The patient summary is written only after signing, from the signed
    // report (B16, callables/generatePatientSummary.ts); none is drafted here.
    at = "summarizing";
    await setStatus("summarizing");

    await setStatus("ready", {
      // Current for an accept-all review, so the common path signs without a GPU call.
      clinicianSummary: clinicianSummary ? { ...clinicianSummary, generatedFromReviewHash: acceptAllHash(findings) } : clinicianSummary,
      patientSummary: null,
      "pipeline.model": mock ? "mock" : MODELS.clinical,
    });
    const startedMs = study.createdAt?.toMillis() ?? null;
    if (startedMs) await recordAnalysisRun(ref.firestore, study.orgId ?? "unknown", Date.now() - startedMs).catch(() => undefined);
  } catch (error) {
    if (error instanceof WrongStateError) {
      // Another run claimed the study, or it moved on; this run just stops.
      logger.warn("pipeline stopped: study changed under this run", { studyId, step: at, stage: error.stage });
      return;
    }
    const code = error instanceof PipelineError ? error.code : "internal";
    const message = error instanceof Error ? error.message : String(error);
    // A rejected image or a model refusal is an outcome the clinician acts
    // on, not a defect; only the rest should page anyone.
    const log = code === "quality_rejected" || code === "model_refused" || isTransient(code) ? logger.warn : logger.error;
    try {
      if (isTransient(code)) {
        // The model service was down, cold or slow: back to the queue while
        // attempts remain; the sweeper runs it again. A cold start does not
        // use up an attempt for the first MAX_WARMING_WAIT_MS.
        const warming = error instanceof ModelsWarming && isWarmingWait(study.createdAt?.toMillis() ?? null, Date.now());
        const outcome = await writer.retryLater({ code, message, at }, { countAttempt: !warming });
        log(outcome === "requeue" ? "pipeline requeued" : "pipeline failed after retries", { studyId, step: at, code });
      } else {
        log("pipeline failed", { studyId, step: at, code });
        await writer.fail({ code, message, at });
      }
    } catch (writeError) {
      logger.warn("pipeline failure not recorded: study changed under this run", {
        studyId,
        step: at,
        reason: writeError instanceof WrongStateError ? writeError.stage : "unknown",
      });
    }
  }
}
