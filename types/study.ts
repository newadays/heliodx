/**
 * studies/{studyId} — one captured or uploaded medical image, the AI draft
 * produced from it, and the clinician's review of that draft.
 *
 * The document id is generated on the client so the Storage object path
 * (`studies/{orgId}/{uid}/{studyId}/original.*`) and the Firestore document agree
 * before the upload starts. The AI pipeline (Cloud Functions) owns `status`,
 * `pipeline`, the first `findings` draft and both summaries; the clinician
 * owns everything under review (`findings[].status`, `editedText`, summary
 * edits, `reviewHash`, `shares`). See the Firestore rules for the exact split.
 *
 * Timestamps are typed `unknown` on purpose, matching `types/user.ts`: the
 * client sees Firestore `Timestamp` instances, Functions see Admin SDK ones,
 * and tests use plain objects. Convert at the edge with
 * `utils/millis.ts`.
 */

/** Capture chips on the camera screen, in display order (design 02). */
export type Modality = "xray" | "ct_mri" | "ultrasound" | "lab" | "skin";

/** How the image reached the app (Home screen actions, design 01). */
/** `sample`: a demo study created by the server from a curated NIH image (card F11). */
export type StudySource = "camera" | "gallery" | "files" | "sample" | "upload";

/**
 * Lifecycle. `uploading` and `queued` are written by the client; the pipeline
 * walks `quality_check → classifying → detecting → summarizing → ready`, or
 * stops at `failed`. The order here is the order of the analyzing stepper.
 */
export const STUDY_STATUSES = [
  "uploading",
  "queued",
  "quality_check",
  "classifying",
  "detecting",
  "summarizing",
  "ready",
  "failed",
  // Case stages after the draft (sign, patient summary, share). Defined so
  // the app handles them; written by later backend cards.
  "clinician_review",
  "signed",
  "patient_summary_ready",
  "shared",
  "closed",
] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

/** The pipeline has finished drafting: the study can be opened for review or later steps. */
export function isDraftReady(status: StudyStatus): boolean {
  return status === "ready" || POST_DRAFT_STATUSES.includes(status);
}

/** Stages after the draft; the pipeline never runs again for these. */
export const POST_DRAFT_STATUSES: readonly StudyStatus[] = [
  "clinician_review",
  "signed",
  "patient_summary_ready",
  "shared",
  "closed",
];

export type StudyPriority = "routine" | "urgent" | "critical";

export interface StudyMeasurement {
  id: string;
  value: number;
  maskIds: string[];
}

export interface StudyTriage {
  priority: StudyPriority;
  /** Minimum priority the thresholds demanded. */
  floor: StudyPriority;
  /** Measurement or mask ids the priority rests on. */
  evidence: string[];
  rationale: string;
  confidence: "low" | "medium" | "high";
  flags: { measurementId: string; level: "critical" | "urgent" | "flag"; value: number; threshold: number }[];
  /** Region between the lungs used for the heart width, [x0, y0, x1, y1] 0-1. */
  heartBox: [number, number, number, number] | null;
}

export interface StudySignature {
  by: string;
  name: string;
  at: unknown; // Firestore Timestamp
  device: string | null;
  /** "sha256:<hex>" over the frozen report. */
  reportHash: string;
  reviewHash: string;
  /** True when the clinician confirmed a drafted impression rather than editing it. */
  impressionConfirmed: boolean;
}

export interface SignedReport {
  studyId: string;
  studyType: string;
  modality: string;
  findings: { id: string; status: string; title: string; text: string }[];
  summary: { findings: string; impression: string[]; recommendation: string };
  signedBy: string;
  signedAt: string;
}

/** Flags beside the status, set by the backend. */
export interface StudyFlags {
  needsRetake: boolean;
  degraded: boolean;
  needsHuman: boolean;
}

/** A status the pipeline will not move away from on its own. */
export function isTerminalStatus(status: StudyStatus): boolean {
  return status === "failed" || isDraftReady(status);
}

export type PipelineErrorCode =
  | "quality_rejected" // image too dark / blurred / glare: offer Retake
  | "model_refused" // safety block or refusal from the model
  | "schema_invalid" // model output failed validation twice
  | "timeout"
  | "model_unavailable" // the private model service is not reachable
  | "internal";

/** Region on the image, normalized to 0–1 of width/height. */
export interface FindingRegion {
  shape: "ellipse" | "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Review state of one finding. `pending` until the clinician acts; `edited`
 * carries the clinician's wording in `editedText`; `rejected` findings are
 * excluded from summaries and sharing.
 */
export type FindingStatus = "pending" | "accepted" | "edited" | "rejected";

export interface Finding {
  id: string;
  /** 0-based display order; the badge shows `index + 1`. */
  index: number;
  title: string;
  description: string;
  /** Model confidence, 0–100. See `utils/confidenceColor.ts`. */
  confidence: number;
  /** null when the model could not localize the finding. */
  region: FindingRegion | null;
  /** Hex from `constants/findingColors.ts`, fixed at draft time. */
  color: string;
  status: FindingStatus;
  /** Clinician's replacement wording when `status === "edited"`. */
  editedText?: string;
  reviewedAt: unknown | null; // Firestore Timestamp
  /** B12: how well the evidence supports it, set in code (shown by card F5). */
  strength?: "strong" | "moderate" | "weak";
  /** B12: the measurements and SAM masks it rests on. */
  evidence?: { measurementIds: string[]; maskIds: string[] };
  /** B12: Storage path of the translucent overlay for its region. */
  overlayPath?: string | null;
  /** B21: "normal", or "attention" when a cited measurement crossed its threshold. */
  polarity?: "normal" | "attention";
  /** B21: "Cardiothoracic ratio 0.45 · limit 0.55"; null when it rests on outlines only. */
  evidenceLine?: string | null;
  /** B21: marker positions (0–1 of width/height), one per region; two for a paired finding. */
  regions?: { x: number; y: number; label?: string }[];
}

/** B21: a measurement drawn on the film (0–1 coordinates), e.g. the CTR widths. */
export interface StudyOverlayLine {
  kind: "line";
  /** `Finding.index` it belongs to, or null for a study-level line. */
  findingIndex: number | null;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label: string;
}

/** Character span inside `ClinicianSummary.findings` tinted by a finding. */
export interface SummaryHighlight {
  findingId: string;
  start: number;
  end: number;
}

export interface ClinicianSummary {
  findings: string;
  impression: string[];
  recommendation: string;
  highlights: SummaryHighlight[];
  /** `Study.reviewHash` the summary was generated from; stale when they differ. */
  generatedFromReviewHash: string | null;
  editedByClinician: boolean;
}

/** One "What happens next" sentence (card B16): a plain rewrite of one signed Recommendation sentence. */
export interface NextStep {
  text: string;
  /** Index of the signed Recommendation sentence it rewrites. */
  mapsTo: number;
  /** Ticked by the clinician; sharing needs every step confirmed (card F8). */
  confirmed: boolean;
  /** The rewrite failed the checks, so the signed sentence is used word for word. */
  fromSignedText?: boolean;
}

/** Written after signing, from the signed report only (card B16). */
export interface PatientSummary {
  /** "A note from Dr. A. Smith about your chest X-ray" */
  title: string;
  body: string;
  nextSteps: NextStep[];
  /** The signer's name, e.g. "Dr. A. Smith". */
  reviewedBy: string;
  /** "Reviewed and approved by Dr. A. Smith"; absent on summaries written before B16. */
  attribution?: string;
  /** Flesch–Kincaid grade of the text (target ≤ 8). */
  readingGrade?: number;
  /** `signed.reportHash` of the report it was written from. */
  generatedFromReportHash?: string | null;
  editedByClinician: boolean;
  /** The text as generated (B16), kept so sharing can record what was edited; never changed by the app. */
  generated?: { body: string; steps: string[] };
}

export type ShareChannel = "whatsapp" | "email" | "pdf";

export interface ShareRecord {
  id: string;
  channel: ShareChannel;
  /** E.164 phone, email address, or "" for a saved PDF. */
  target: string;
  sentAt: unknown; // Firestore Timestamp
  /** Storage path of the generated PDF, when one was produced. */
  pdfPath?: string;
  linkExpiresAt?: unknown; // Firestore Timestamp
  /** B17: recorded by the backend with each share. */
  consent?: { given: boolean; note: string; by: string; at: unknown };
  generatedFromReportHash?: string | null;
  summaryEdited?: boolean;
  steps?: { mapsTo: number; confirmed: boolean; edited: boolean; fromSignedText: boolean }[];
}

export interface StudyImage {
  storagePath: string;
  /** 512 px JPEG written by the pipeline; null until it exists. */
  thumbPath: string | null;
  width: number;
  height: number;
  bytes: number;
  contentType: string;
}

export interface StudyPatient {
  name: string;
  /** E.164, used for the WhatsApp share. */
  phone?: string;
  email?: string;
}

export interface PipelineQuality {
  ok: boolean;
  /** 0–100 */
  score: number;
  issues: string[];
}

export interface StudyPipeline {
  /** Idempotency key for the Storage trigger. */
  runId: string | null;
  startedAt?: unknown; // Firestore Timestamp
  /** When each status was entered. */
  stepTimestamps: Partial<Record<StudyStatus, unknown>>;
  quality?: PipelineQuality;
  /** Model id used for the findings pass. */
  model?: string;
  /** `at` is the status the pipeline was in when it stopped. */
  error?: { code: PipelineErrorCode; message: string; at?: StudyStatus };
  /** The last transient error before a requeue (cold GPU, timeout). */
  lastError?: { code: PipelineErrorCode; message: string; at?: StudyStatus };
  attempts?: number;
  /** Waiting for a cold private GPU: when the wait began (first attempt) and when it was ready. */
  warming?: { since: unknown; readyAt?: unknown; waitedMs?: number; glimmer?: string; sam?: string };
}

export interface Study {
  id: string;
  /** B21 + §4.11: short readable case id prefixed by source, e.g. "U-7K2P", "S-AI2Y7" (older studies: "AI2Y7" or derived from the id). */
  caseId?: string;
  /** §4.11: who created it (uploads: the clinician; samples: whoever added it). */
  createdBy?: string;
  /** §4.11: uploads are the owner's only; samples belong to the workspace (owner id "samples"). */
  visibility?: "owner" | "workspace";
  /** B21: projection of the film as detected ("PA" | "AP"); null when unknown. */
  view?: "PA" | "AP" | null;
  /** B22: analysis expectations for the progress display. */
  analysis?: { expectedMs?: number; expectedFindings?: number };
  /** B21: measurement lines for the viewer. */
  overlays?: StudyOverlayLine[];
  orgId: string;
  clinicianUid: string;
  /** Snapshot of the clinician's display name at creation. */
  clinicianName: string;
  patient: StudyPatient;
  modality: Modality;
  /** Model-confirmed study type, e.g. "Chest X-ray (PA)". */
  studyType: string;
  clinicalContext: string;
  source: StudySource;
  image: StudyImage;
  status: StudyStatus;
  /** Absent on studies created before flags existed. */
  flags?: Partial<StudyFlags>;
  /** Reading priority set by triage (B11); code sets the floor from the measurements. */
  priority?: StudyPriority;
  triage?: StudyTriage;
  /** Chest measurements from the SAM lung masks (B10). */
  measurements?: StudyMeasurement[];
  /** Set when the clinician signs (B15); the study is then read-only. */
  signed?: StudySignature;
  /** The report text frozen at signing; `signed.reportHash` is its SHA-256. */
  report?: SignedReport;
  pipeline: StudyPipeline;
  /** Uploads (§4.10): the details the clinician gave; `patient.name` holds their pseudonym label. */
  details?: { age: number | null; sex: "F" | "M" | null; indication: string | null; view: "PA" | "AP" | null };
  /** Uploads (§4.10): what the browser removed, redacted or overrode, and the research-contribution confirmation. */
  upload?: {
    format: "dicom" | "jpeg" | "png";
    removedTags: number;
    kept: Record<string, string>;
    redactions: { x: number; y: number; w: number; h: number }[];
    textKept: boolean;
    overrides: string[];
    pixelHash: string;
    width: number;
    height: number;
    contribution: { given: boolean; text: string; at: unknown };
  };
  /** Demo studies only (F11): the sample and its synthetic patient details. */
  demo?: { sampleId: string; sampleIndex?: number; age: number | null; sex: "F" | "M" | null; indication: string | null };
  findings: Finding[];
  clinicianSummary: ClinicianSummary | null;
  /** B23 background draft: `forHash` is claimed while drafting and cleared with `failedAt` when the model didn't answer. */
  reportDraft?: { forHash?: string | null; startedAt?: unknown; doneAt?: unknown; failedAt?: unknown } | null;
  patientSummary: PatientSummary | null;
  /** Hash of the reviewed findings; see `utils/reviewHash.ts` (card 2.7). */
  reviewHash: string | null;
  shares: ShareRecord[];
  deletedAt: unknown | null; // Firestore Timestamp
  createdAt: unknown; // Firestore Timestamp
  updatedAt: unknown; // Firestore Timestamp
}

/** One recorded model call, tool call or check for a study (card B19, `studies/{id}/trace`). */
export interface TraceEntry {
  id: string;
  at: unknown; // Firestore Timestamp
  seq: number;
  stage: string;
  kind: "model" | "tool" | "check";
  name: string;
  model?: string;
  route?: string;
  ms?: number;
  promptTokens?: number | null;
  outputTokens?: number | null;
  attempt?: number;
  ok: boolean;
  args?: Record<string, unknown>;
  result?: string;
  overlayPath?: string;
  /** Demo organization only: the model call's prompt and raw answer (W10). */
  detail?: { prompt?: string; raw?: string };
}

/** One audit entry (status change or named action), `studies/{id}/audit`. */
export interface AuditEntry {
  id: string;
  at: unknown; // Firestore Timestamp
  actor: string;
  action: string;
  from: StudyStatus | null;
  to: StudyStatus | null;
  code?: string;
  detail?: Record<string, unknown>;
}
