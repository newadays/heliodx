/**
 * HelioDX — UI data contracts (v1, 28 Oct 2026).
 * These are what the screens render. Backend payloads should map onto them 1:1;
 * see SPEC.md §3 for semantics and §3.3 for demo fixture values.
 */

export type CaseId = `U-${string}` | `S-${string}`; // prefixed by source, e.g. "U-7K2P", "S-AI2Y7"

export type StudySource = 'upload' | 'sample';

export type Provenance =
  | {
      source: 'upload';
      uploadedBy: string;          // clinician display name or initials
      uploadedAt: string;          // ISO
      format: 'jpeg' | 'png' | 'dicom';
      removedTagCount: number;     // 0 for JPEG/PNG
      redactionCount: number;
      overrides: ('kept_text' | 'analyze_anyway')[];
      originalFileName?: string;   // shown to the uploader only; never exported
    }
  | {
      source: 'sample';
      dataset: 'NIH ChestX-ray14';
      synthetic: true;
      sampleIndex: number;
    };

export type StudyStatus = 'analyzing' | 'draft_ready' | 'in_review' | 'signed' | 'shared' | 'failed';

export type Step = 'analyzing' | 'review' | 'sign' | 'share' | 'done';

export interface Patient {
  displayName: string;   // "Sample Patient 1"
  firstName: string;     // used in "Share with Sample"
  age?: number;
  sex?: 'M' | 'F' | 'X';
  contact?: {
    whatsapp?: string;   // E.164
    email?: string;
  };
}

export interface StudyImage {
  url: string;
  width: number;         // px
  height: number;        // px
  quality: 'ok' | 'review' | 'failed';
  sharpness?: number;
  brightness?: number;
  clippedPct?: number;
}

export type Polarity = 'normal' | 'attention';
export type ConfidenceBand = 'high' | 'moderate' | 'low';   // ≥0.85, ≥0.6, else
export type Decision = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface Region {
  x: number;             // 0–100, % of image width
  y: number;             // 0–100, % of image height
  label?: string;        // e.g. "right costophrenic angle"
}

export interface Measurement {
  name: string;          // "Cardiothoracic ratio"
  value: number;
  limit: number;
  unit?: '' | '%' | 'ratio';
  comparator?: '<' | '<=' | '>' | '>=';
}

export interface Overlay {
  kind: 'line' | 'ellipse' | 'mask';
  findingN: number;
  // line: from/to in %; ellipse: center + radii in %; mask: url
  from?: Region; to?: Region; center?: Region; rx?: number; ry?: number; url?: string;
  label?: string;        // "heart 0.45"
}

export interface Finding {
  n: number;             // 1-based, stable for the study
  title: string;
  evidence: string;      // one line, "measure · limit" form, numbers to 2 dp
  measurement?: Measurement;
  confidence: number;    // 0–1
  confidenceBand: ConfidenceBand;
  polarity: Polarity;
  regions: Region[];     // one marker per region
  sentence: string;      // the report sentence as drafted
  decision: Decision;
  editedText?: string;   // set when decision === 'edited'
  decidedAt?: string;    // ISO
}

export interface ReportSignature {
  by: string;            // "Dr. Demo Clinician"
  at: string;            // ISO
  sha256: string;        // of the canonical report text
}

export interface Report {
  title: string;         // "Chest X-ray · PA · Sample Patient 1, 34 M"
  findings: { n: number; text: string; edited: boolean }[];
  impression: string[];
  recommendation: string;
  draftedFromDecisionHash: string;   // to detect stale drafts
  signed?: ReportSignature;
}

export type NoteCheck =
  | { status: 'ok'; checkedAgainst: string }                       // signed report hash
  | { status: 'unsupported'; checkedAgainst: string; sentences: number }
  | { status: 'rewriting' }
  | { status: 'pending' };                                           // drafts after signing (policy)

export interface PatientNote {
  title: string;         // "About your chest X-ray"
  fromLine: string;      // "Dr. Demo Clinician · Acme Health"
  date: string;          // display date
  body: string;
  nextSteps: string[];
  approvedBy: string;    // "Reviewed and approved by …"
  readingGrade?: number;
  check: NoteCheck;
}

export type Channel = 'whatsapp' | 'email' | 'pdf';

export interface Share {
  channel: Channel;
  destination?: string;  // phone / email; absent for pdf
  consent: { recorded: boolean; note?: string; at: string };
  at: string;            // ISO
  by: string;
}

export type TraceKind = 'system' | 'model' | 'clinician';

export interface TraceStep {
  id: string;
  name: 'Received' | 'Intake' | 'Triage' | 'Prep' | 'Reviewed' | 'Signed' | 'Patient note' | 'Shared' | string;
  kind: TraceKind;
  startedAt: string;     // ISO
  agents: string[];      // ["Intake"]
  models: string[];      // ["Glimmer", "SAM 3.1"]
  durationMs?: number;
  tokens?: number;
  summary: string;
  traceId?: string;
  detail?: {
    inputs?: string[];
    outputs?: string[];
    measurements?: string[];
    prompt?: string;
    raw?: string;
    timing?: { label: string; ms: number }[];
  };
}

export interface Study {
  caseId: CaseId;
  source: StudySource;             // immutable; equals provenance.source and the caseId prefix
  provenance: Provenance;
  visibility: 'owner' | 'workspace'; // uploads: owner; samples: workspace
  capabilities: { delete: boolean; reset: boolean }; // uploads: delete (until signed); samples: reset
  patient: Patient;
  modality: 'Chest X-ray';
  view: 'PA' | 'AP';
  indication: string;
  arrivedAt: string;     // ISO
  status: StudyStatus;
  step: Step;
  image: StudyImage;
  analysis: {
    elapsedMs: number;
    expectedMs: number;  // rolling median of recent runs
    currentStep?: TraceStep['name'];
    expectedFindings?: number;
  };
  findings: Finding[];
  overlays: Overlay[];
  report?: Report;
  patientNote?: PatientNote;
  shares: Share[];
  trace: TraceStep[];
}

/** Streaming events for /study/:caseId (SSE or WebSocket). */
export type StudyEvent =
  | { type: 'trace_step'; step: TraceStep }
  | { type: 'finding'; finding: Finding; expectedTotal?: number }
  | { type: 'overlay'; overlay: Overlay }
  | { type: 'report_draft'; report: Report }
  | { type: 'patient_note_draft'; note: PatientNote }
  | { type: 'status'; status: StudyStatus }
  | { type: 'done' }
  | { type: 'error'; message: string; retryable: boolean };

/** Worklist row projection. */
export interface WorklistRow {
  caseId: CaseId;
  source: StudySource;
  sourceLine: string;    // "by DC at 14:52 · U-7K2P" | "synthetic · S-AI2Y7"
  studyLine: string;     // "PA · JPEG · 14 tags removed" | "PA · NIH ChestX-ray14"
  thumbnailUrl: string;
  patient: Pick<Patient, 'displayName' | 'age' | 'sex'>;
  modality: Study['modality'];
  view: Study['view'];
  imageCount: number;
  indication: string;
  status: StudyStatus;
  statusDetail: string;  // "6 findings · all within normal limits" | "Prep · 12 s" | "Patient note shared · PDF"
  progressPct?: number;  // analyzing only
  arrivedAt: string;
}

/** Upload a study (SPEC.md §4.10, §5.10) — all client side until `upload`. */
export type UploadFormat = 'dicom' | 'jpeg' | 'png';

export type UploadStage =
  | 'queued' | 'decoding' | 'deidentifying' | 'checking' | 'uploading'
  | 'ready' | 'attention' | 'failed' | 'started' | 'cancelled';

export type UploadIssue =
  | { kind: 'not_frontal_chest' }
  | { kind: 'field_of_view'; missing: ('apices' | 'bases')[] }
  | { kind: 'too_small'; shortSidePx: number }
  | { kind: 'burned_in_text'; regions: FlagRegion[] }
  | { kind: 'duplicate'; ofCaseId: CaseId }
  | { kind: 'unsupported_format' }
  | { kind: 'too_large'; bytes: number }
  | { kind: 'decode_error'; message: string };

export interface FlagRegion {
  x: number; y: number; w: number; h: number;   // % of image
  label?: string;                                // "Text detected"
  confidence?: number;
}

export interface DeidSummary {
  removedTags: { tag: string; name: string }[];  // e.g. { tag: '(0010,0010)', name: 'Patient name' }
  keptTags: { tag: string; name: string; value: string }[];
  dateShiftDays: number;                         // same offset for every date in the file
  redactions: FlagRegion[];                      // filled black in the pixel data
  overrides: ('kept_text' | 'analyze_anyway')[]; // clinician choices, written to the Received trace step
}

export interface UploadDetails {
  patientLabel: string;      // pseudonym, default "Upload N · <date>"
  age?: number;
  sex?: 'F' | 'M' | 'X';
  view: 'PA' | 'AP';
  viewDetected?: 'PA' | 'AP';
  indication: string;
  noIdentifiersConfirmed: boolean;   // required per file
}

export interface UploadFile {
  id: string;
  name: string;
  bytes: number;
  format?: UploadFormat;
  stage: UploadStage;
  progressPct?: number;              // uploading only
  thumbnailUrl?: string;             // object URL after decode
  image?: Pick<StudyImage, 'width' | 'height' | 'quality' | 'sharpness' | 'brightness' | 'clippedPct'>;
  issues: UploadIssue[];             // non-empty → 'attention' or 'failed'
  deid?: DeidSummary;                // DICOM only
  details: UploadDetails;
  caseId?: CaseId;                   // set once analysis has started
}

export interface UploadBatch {
  files: UploadFile[];
  readyCount: number;
  canStart: boolean;                 // every ready file has noIdentifiersConfirmed
  blockingHint?: string;             // text for the disabled Start button's aria-describedby
}

/** Worklist response: sections in display order; uploads always first. */
export interface Worklist {
  sections: { source: StudySource; title: 'Your uploads' | 'Sample studies'; rows: WorklistRow[] }[];
  counts: { all: number; ready: number; analyzing: number; signed: number };
  sourceFilter: 'all' | 'uploads' | 'samples';
}

/** Console totals for a case. */
export interface TraceTotals {
  agentTimeMs: number;
  tokens: number;
  modelSteps: number;
  clinicianSteps: number;
  arrivalToSharedMs?: number;
}
