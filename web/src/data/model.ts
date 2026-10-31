/**
 * The study as the redesigned screens see it (design/types.ts), projected
 * from the Firestore document. Pure, so the status mapping, evidence lines,
 * verdicts and progress are unit-tested. Fields that new pipeline runs store
 * (B21: caseId, view, polarity, evidenceLine, regions) win; older studies
 * fall back to values derived here.
 */
import { confidenceBand, evidenceLine } from "@/functions/src/lib/evidence";
import { readNeed, readRequirement, READ_REASON_TEXT } from "@/functions/src/radiology/gate";
import type { Finding, FindingStatus, ShareChannel, Study, StudyStatus } from "@/types/study";
import { caseId as derivedCaseId } from "@/utils/caseTimeline";
import { findingPolarity } from "@/functions/src/lib/polarity";
import { tsToMillis } from "@/utils/millis";

export type ViewStatus = "analyzing" | "draft_ready" | "in_review" | "signed" | "shared" | "failed";
export type Step = "analyzing" | "review" | "sign" | "share" | "done";
export const STEPS: Step[] = ["analyzing", "review", "sign", "share", "done"];

const ANALYZING: StudyStatus[] = ["uploading", "queued", "quality_check", "classifying", "detecting", "summarizing"];

export function caseIdOf(study: Pick<Study, "id" | "caseId">): string {
  return study.caseId || derivedCaseId(study.id);
}

export interface PatientView {
  displayName: string;
  firstName: string;
  age: number | null;
  sex: "F" | "M" | null;
  /** "34 M", or "" when unknown. */
  ageSex: string;
}

export function patientOf(study: Pick<Study, "patient" | "demo" | "details"> & { source?: Study["source"] }): PatientView {
  const displayName = study.patient?.name?.trim() || "Unnamed patient";
  // An upload's label is a pseudonym ("Upload 3 · 28 Oct"): use all of it, never a first word.
  const pseudonym = study.source === "upload";
  const info = study.details ?? study.demo;
  const age = info?.age ?? null;
  const sex = info?.sex ?? null;
  return {
    displayName,
    firstName: pseudonym ? displayName : displayName.split(/\s+/)[0],
    age,
    sex,
    ageSex: [age, sex].filter((v) => v !== null && v !== undefined).join(" "),
  };
}

export function viewOf(study: Pick<Study, "view" | "studyType"> & { details?: Study["details"] }): "PA" | "AP" | null {
  if (study.view) return study.view;
  if (study.details?.view) return study.details.view;
  const t = study.studyType ?? "";
  if (/\bAP\b/.test(t)) return "AP";
  if (/\bPA\b/.test(t)) return "PA";
  return null;
}

/** "Chest X-ray · PA" */
export function studyLabel(study: Pick<Study, "view" | "studyType" | "modality">): string {
  const view = viewOf(study);
  const modality = study.modality === "xray" || /x-?ray/i.test(study.studyType ?? "") ? "Chest X-ray" : study.studyType || "Study";
  return view ? `${modality} · ${view}` : modality;
}

export function indicationOf(study: Pick<Study, "demo" | "details" | "clinicalContext">): string {
  return (study.details?.indication ?? study.demo?.indication ?? study.clinicalContext ?? "").trim();
}

export function arrivedAt(study: Pick<Study, "createdAt">): number | null {
  return tsToMillis(study.createdAt) || null;
}

export function viewStatus(study: Pick<Study, "status" | "findings">): ViewStatus {
  const s = study.status;
  if (ANALYZING.includes(s)) return "analyzing";
  if (s === "failed") return "failed";
  if (s === "ready" || s === "clinician_review") {
    return (study.findings ?? []).some((f) => f.status !== "pending") ? "in_review" : "draft_ready";
  }
  if (s === "signed" || s === "patient_summary_ready") return "signed";
  return "shared";
}

/** Where the workspace opens for this study. */
export function defaultStep(study: Pick<Study, "status">): Step {
  const s = study.status;
  if (ANALYZING.includes(s) || s === "failed") return "analyzing";
  if (s === "ready" || s === "clinician_review") return "review";
  if (s === "signed" || s === "patient_summary_ready") return "share";
  return "done";
}

/** Furthest step the study has reached (the rail links back to anything before it). */
export function reachedStep(study: Pick<Study, "status">): Step {
  return defaultStep(study);
}

export function isSigned(study: Pick<Study, "status" | "signed">): boolean {
  return !!study.signed || ["signed", "patient_summary_ready", "shared", "closed"].includes(study.status);
}

// ---- Findings ---------------------------------------------------------------

export type Band = "high" | "moderate" | "low";

export interface FindingView {
  id: string;
  n: number;
  title: string;
  /** One line; numbers rendered in mono. */
  evidence: string;
  /** The wording that goes into the report. */
  sentence: string;
  /** 0–1 */
  confidence: number;
  band: Band;
  polarity: "normal" | "attention";
  /** Marker positions in % of the image. */
  regions: { x: number; y: number; label?: string }[];
  /** Region outline for the spotlight, in %; null when unknown. */
  spot: { x: number; y: number; w: number; h: number } | null;
  decision: FindingStatus;
  editedText?: string;
}

export function findingView(f: Finding, study: Pick<Study, "measurements" | "triage">): FindingView {
  const measurementIds = f.evidence?.measurementIds ?? [];
  const flagged = new Set((study.triage?.flags ?? []).map((x) => x.measurementId));
  const confidence = Math.max(0, Math.min(1, (f.confidence ?? 0) / 100));
  const line = f.evidenceLine !== undefined ? f.evidenceLine : evidenceLine(measurementIds, study.measurements ?? []);
  const regions = f.regions?.length
    ? f.regions.map((r) => ({ x: r.x * 100, y: r.y * 100, label: r.label }))
    : f.region
      ? [{ x: (f.region.x + f.region.w / 2) * 100, y: (f.region.y + f.region.h / 2) * 100 }]
      : [];
  return {
    id: f.id,
    n: f.index + 1,
    title: f.title,
    evidence: line || f.description,
    sentence: f.status === "edited" && f.editedText ? f.editedText : f.description,
    confidence,
    band: confidenceBand(confidence),
    polarity: findingPolarity(f, flagged),
    regions,
    spot: f.region ? { x: f.region.x * 100, y: f.region.y * 100, w: f.region.w * 100, h: f.region.h * 100 } : null,
    decision: f.status,
    editedText: f.editedText,
  };
}

export function findingsOf(study: Pick<Study, "findings" | "measurements" | "triage">): FindingView[] {
  return [...(study.findings ?? [])].sort((a, b) => a.index - b.index).map((f) => findingView(f, study));
}

/** "6 findings · all within normal limits" / "6 findings · 2 need attention" */
export function verdict(findings: Pick<FindingView, "polarity">[]): { text: string; attention: number } {
  const n = findings.length;
  const attention = findings.filter((f) => f.polarity === "attention").length;
  const noun = `${n} finding${n === 1 ? "" : "s"}`;
  if (!attention) return { text: `${noun} · all within normal limits`, attention };
  return { text: `${noun} · ${attention} need${attention === 1 ? "s" : ""} attention`, attention };
}

export function bandLabel(band: Band): string {
  return band === "high" ? "High" : band === "moderate" ? "Moderate" : "Low";
}

export function bandBars(band: Band): number {
  return band === "high" ? 3 : band === "moderate" ? 2 : 1;
}

// ---- Analysis progress --------------------------------------------------------

const STAGE_PCT: Partial<Record<StudyStatus, number>> = {
  uploading: 2,
  queued: 10,
  quality_check: 30,
  classifying: 45,
  detecting: 45,
  summarizing: 90,
};

/** SPEC §4.3: Received 10 %, Intake 30 %, Triage 45 %, Prep 45→100 % by findings streamed / expected. */
export function analysisProgress(study: Pick<Study, "status" | "findings" | "analysis">): number {
  if (!ANALYZING.includes(study.status)) return study.status === "failed" ? 0 : 100;
  if (study.status === "detecting" || study.status === "summarizing") {
    const expected = study.analysis?.expectedFindings ?? 0;
    const found = (study.findings ?? []).length;
    const base = STAGE_PCT[study.status] ?? 45;
    if (expected > 0) return Math.min(99, Math.round(45 + (55 * Math.min(found, expected)) / expected));
    return base;
  }
  return STAGE_PCT[study.status] ?? 0;
}

const STAGE_NAME: Partial<Record<StudyStatus, string>> = {
  uploading: "Received",
  queued: "Received",
  quality_check: "Intake",
  classifying: "Triage",
  detecting: "Prep",
  summarizing: "Prep",
};

export function currentStage(study: Pick<Study, "status">): string {
  return STAGE_NAME[study.status] ?? "";
}

/** Analysis time so far (or total, once drafted), from the step timestamps. */
/** From arrival, so a requeue (cold GPU) never resets the clock. */
export function analysisElapsedMs(study: Pick<Study, "createdAt" | "pipeline" | "status">, now: number): number {
  const start = tsToMillis(study.createdAt) || tsToMillis(study.pipeline?.stepTimestamps?.queued);
  if (!start) return 0;
  // A ready time only ends the clock once the study is drafted (a re-run keeps the old one).
  const end = ANALYZING.includes(study.status) ? 0 : tsToMillis(study.pipeline?.stepTimestamps?.ready);
  return Math.max(0, (end || now) - start);
}

export const DEFAULT_EXPECTED_MS = 30_000;

export function expectedMs(study: Pick<Study, "analysis">): number {
  return study.analysis?.expectedMs ?? DEFAULT_EXPECTED_MS;
}

/**
 * Waiting for the private GPU to start: the pipeline is holding the case
 * (pipeline.warming without readyAt), or put it back in the queue after a
 * cold-start or timeout error.
 */
export function gpuState(study: Pick<Study, "status" | "pipeline">): "waiting" | "ready" | null {
  const w = study.pipeline?.warming;
  const transient = study.pipeline?.lastError?.code === "model_unavailable" || study.pipeline?.lastError?.code === "timeout";
  if (!ANALYZING.includes(study.status)) return w ? "ready" : null;
  if (w && !w.readyAt) return "waiting";
  if (study.status === "queued" && transient) return "waiting";
  return w ? "ready" : null;
}

export function gpuWaitStart(study: Pick<Study, "pipeline" | "createdAt">): number {
  return tsToMillis(study.pipeline?.warming?.since) || tsToMillis(study.createdAt);
}

// ---- Shares --------------------------------------------------------------------

export const CHANNEL_LABEL: Record<ShareChannel, string> = { whatsapp: "WhatsApp", email: "Email", pdf: "PDF" };

export function lastShare(study: Pick<Study, "shares">) {
  const shares = study.shares ?? [];
  return shares.length ? shares[shares.length - 1] : null;
}

/** Stopped by the image quality check (resolution, blur, not a medical image): retrying can't help. */
export function isQualityRejected(study: Study): boolean {
  return study.status === "failed" && study.pipeline?.error?.code === "quality_rejected";
}

/** Quality notes that didn't stop the analysis (glare, exposure, a model "retake"), for Review. */
export function qualityWarnings(study: Study): string[] {
  return study.pipeline?.quality?.warnings ?? [];
}

/**
 * B14 · The radiologist read as one line: "Sent to Dr. N. Okafor (simulated)
 * · critical · ETA 3 min", "Read by Dr. N. Okafor (simulated) · Agree …".
 * `need` is what signing waits for: "request" (required, none yet), "close"
 * (open) or null.
 */
export interface ReadView {
  state: "none" | "open" | "signed";
  need: "request" | "close" | null;
  line: string;
  /** Why the gate requires a read, when it does. */
  reason: string | null;
  /** The coordinator recommended one (a hint, not the gate). */
  suggested: boolean;
}

export function readOf(study: Study, now: number): ReadView {
  const r = study.radiologistRead;
  const gate = readRequirement(study);
  const reason = r ? READ_REASON_TEXT[r.reason] : gate ? READ_REASON_TEXT[gate.reason] : null;
  const suggested = !!study.coordinator?.radiologistReadSuggested;
  if (!r) return { state: "none", need: readNeed(study), line: gate ? `Radiologist read required · ${reason}` : "", reason, suggested };
  const who = `${r.assigneeName} (simulated)`;
  if (r.status === "signed") return { state: "signed", need: null, line: `Read by ${who}${r.note ? ` · ${r.note}` : ""}`, reason, suggested };
  const left = tsToMillis(r.eta) - now;
  const eta = left > 30_000 ? `ETA ${Math.max(1, Math.round(left / 60_000))} min` : r.profile === "silent" && r.nudgedAt ? "reminder sent" : "due now";
  const from = r.reassignedFrom ? ` · reassigned from ${r.reassignedFrom} (simulated)` : "";
  return { state: "open", need: "close", line: `Sent to ${who} · ${reason} · ${eta}${from}`, reason, suggested };
}

/** Worklist status line under the chip. */
export function statusDetail(study: Study, now: number): string {
  const vs = viewStatus(study);
  if (vs === "analyzing") {
    const stage = gpuState(study) === "waiting" ? "Starting the GPU" : currentStage(study) || "Queued";
    return `${stage} · ${Math.round(analysisElapsedMs(study, now) / 1000)} s`;
  }
  if (vs === "failed") {
    // A quality rejection is a decision about the image, not a fault: say why.
    if (isQualityRejected(study)) return `Image rejected · ${study.pipeline?.quality?.issues?.[0] ?? study.pipeline?.error?.message ?? "quality check"}`;
    return "Analysis didn't complete";
  }
  if (vs === "draft_ready" || vs === "in_review") {
    const v = verdict(findingsOf(study));
    return v.text;
  }
  const share = lastShare(study);
  if (share) {
    const at = tsToMillis(share.sentAt);
    const when = at ? ` · ${new Date(at).toTimeString().slice(0, 5)}` : "";
    return share.channel === "pdf" ? `Note saved as PDF${when}` : `Note sent · ${CHANNEL_LABEL[share.channel]}${when}`;
  }
  return study.status === "patient_summary_ready" ? "Patient note ready to save" : "Patient note drafting";
}
