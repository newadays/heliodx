/**
 * HelioDX agent console — UI data contracts (29 Oct 2026).
 * Both console surfaces (worklist side panel, dedicated page) render exactly these.
 */

export type CaseId = `U-${string}` | `S-${string}`;   // source-prefixed, e.g. "S-AI2Y7", "U-7K2P"
export type StudySource = 'upload' | 'sample';

export type TraceKind = 'system' | 'model' | 'clinician';
export type StepStatus = 'done' | 'running' | 'failed' | 'escalated';
export type CallResult = 'ok' | 'failed' | 'escalated';

export interface Check {
  name: string;           // "sharpness ≥ 80"
  passed: boolean;
  detail?: string;
}

export interface ToolCall {
  tool: string;           // "measure"
  args: Record<string, unknown>;
  startedAt: string;      // ISO
  durationMs: number;
  result: CallResult;
  checks?: Check[];
}

export interface TraceStepDetail {
  inputs?: string[];
  outputs?: string[];
  measurements?: string[];
  calls?: ToolCall[];
  checks?: Check[];
  prompt?: string;
  raw?: string;
  timing?: { label: string; ms: number }[];
}

export interface TraceStep {
  id: string;             // traceId; deep-linkable via ?step=
  name: 'Received' | 'Intake' | 'Triage' | 'Prep' | 'Reviewed' | 'Signed' | 'Patient note' | 'Shared' | 'Reset' | string;
  kind: TraceKind;
  status: StepStatus;
  startedAt: string;      // ISO
  agents: string[];       // ["Intake"]; Received carries ["Sample"] or ["Upload"]
  models: string[];       // ["Glimmer", "SAM 3.1"]
  durationMs?: number;    // absent for clinician steps; elapsed while running
  tokens?: number;
  summary: string;        // one line; model steps end with "· N tool calls"
  detail?: TraceStepDetail;
}

export interface AgentDef {
  id: string;             // "coordinator" | "intake" | "triage" | "prep" | "summary" | …
  name: string;
  models: string[];
  role: string;           // one sentence, from the manifest
  order: number;
  status?: 'ran' | 'running' | 'idle';   // for the selected run
}

export interface ToolDef {
  name: string;
  params: string[];
  description: string;    // one or two lines
  ownerAgentId?: string;
  callsInRun?: number;    // for the selected run
}

export interface RunManifest {
  runId: string;          // "run-20261028T142704Z-s-ai2y7"
  caseId: CaseId;
  agents: AgentDef[];
  tools: ToolDef[];
}

export type RunStatus = 'running' | 'awaiting_review' | 'signed' | 'shared' | 'failed' | 'escalated';

export interface RunStats {
  runId: string;
  status: RunStatus;
  // shown as tiles (page: all seven; panel: the first four)
  toolCalls: number;
  agentTokens: number;
  agentTimeMs: number;
  observations: number;
  checksPassed: number;
  checksFailed: number;   // red when > 0, green when 0
  clinicianSteps: number;
  arrivalToSharedMs?: number;   // or arrivalToNowMs while open
  // kept for exports; not shown as tiles
  agentTurns?: number;
  measurements?: number;
  escalations?: number;
}

/** Row shape for the panel's case select and the page's run select. */
export interface ConsoleCase {
  caseId: CaseId;
  runId: string;
  patientLabel: string;   // "Sample Patient 1" | "Upload 1 · 28 Oct"
  source: StudySource;
  status: RunStatus;
  arrivedAt: string;      // ISO
  running?: { step: TraceStep['name']; elapsedMs: number };
}

/** Everything a console surface needs for one run. */
export interface ConsoleRun {
  case: ConsoleCase;
  manifest: RunManifest;
  stats: RunStats;
  trace: TraceStep[];
}

/** Workspace stream events (SSE or WebSocket); both surfaces subscribe and filter by runId. */
export type ConsoleEvent =
  | { type: 'trace_step'; runId: string; step: TraceStep }        // new or updated (running heartbeats carry elapsed)
  | { type: 'run_stats'; runId: string; stats: RunStats }
  | { type: 'run_status'; runId: string; status: RunStatus }
  | { type: 'error'; message: string; retryable: boolean };
