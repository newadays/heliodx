/**
 * Agent console · one run as data (design/agent-console SPEC §2–§4): the
 * steps, the statistics and the per-tool call counts both console surfaces
 * render. Built on `buildTimeline` (the stage rows) and the run manifest
 * (functions/src/lib/consoleManifest.ts); the side panel shows the first four
 * statistics, the page all seven, so the two always agree.
 */
import { CONSOLE_AGENTS, CONSOLE_TOOLS, isModelCall, type ConsoleAgent } from "@/functions/src/lib/consoleManifest";
import type { Study, TraceEntry } from "@/types/study";
import { buildTimeline, caseId as derivedCaseId, type TimelineRow } from "@/utils/caseTimeline";
import { tsToMillis } from "@/utils/millis";

export type StepKind = "system" | "model" | "clinician";
export type RunStatus = "running" | "awaiting_review" | "signed" | "shared" | "failed";

export interface ConsoleStep extends TimelineRow {
  /** Display name ("Patient note" for the summary row). */
  title: string;
  kind: StepKind;
  /** Tool and check entries, in order (model calls excluded). */
  calls: TraceEntry[];
  checksPassed: number;
  /** Failed checks the step did not recover from. */
  checksFailed: number;
  /** Failed checks the step recovered from, by trace id: "retried" (the same check, or its follow-up, passed later) or "overridden" (the clinician chose to analyze anyway). Not counted as failed. */
  recovered: Record<string, "retried" | "overridden">;
  /** One line; model steps end with "· N tool calls". */
  summary: string;
}

export interface RunStats {
  runId: string;
  status: RunStatus;
  toolCalls: number;
  agentTokens: number;
  agentTimeMs: number;
  observations: number;
  checksPassed: number;
  checksFailed: number;
  clinicianSteps: number;
  /** Received → first share; null until shared. */
  arrivalToSharedMs: number | null;
  /** Received → now while the run is not yet shared. */
  arrivalToNowMs: number | null;
  /** Kept for exports; not shown as tiles. */
  modelCalls: number;
}

const TITLE: Record<string, string> = { summary: "Patient note" };
const CHECK = new Set(CONSOLE_TOOLS.filter((t) => t.kind === "check").map((t) => t.name));

/** Tool and check entries (everything but model calls). */
export function toolCalls(trace: TraceEntry[]): TraceEntry[] {
  return trace.filter((t) => t.kind !== "model" && !isModelCall(t.name));
}

const isCheck = (t: TraceEntry) => t.kind === "check" || CHECK.has(t.name);

/**
 * What shows a failed check was recovered from, besides the same check
 * passing later: the note check's follow-up after its retry, and the
 * clinician's override of a quality stop.
 */
const RECOVERED_BY: Record<string, { name: string; how: "retried" | "overridden" }[]> = {
  check_patient_summary: [{ name: "map_next_steps", how: "retried" }],
  measure_quality: [{ name: "quality_override", how: "overridden" }],
};

/** Trace order across runs: `seq` restarts in every trace scope, so order by time first. */
const byTime = (a: TraceEntry, b: TraceEntry) => tsToMillis(a.at) - tsToMillis(b.at) || a.seq - b.seq;

function recoveredChecks(checks: TraceEntry[]): Record<string, "retried" | "overridden"> {
  const ordered = [...checks].sort(byTime);
  const out: Record<string, "retried" | "overridden"> = {};
  ordered.forEach((c, i) => {
    if (c.ok) return;
    const after = ordered.slice(i + 1).filter((l) => l.ok);
    const via = RECOVERED_BY[c.name]?.find((r) => after.some((l) => l.name === r.name));
    if (via) out[c.id] = via.how;
    else if (after.some((l) => l.name === c.name)) out[c.id] = "retried";
  });
  return out;
}

export function consoleSteps(study: Study, trace: TraceEntry[], now = Date.now()): ConsoleStep[] {
  return buildTimeline(study, trace, now).map((r) => {
    // B14: the radiologist read is a human step (simulated readers, no model) whatever its state.
    const kind: StepKind = r.state === "human" || r.key === "read" ? "clinician" : r.key === "received" ? "system" : "model";
    const calls = toolCalls(r.trace);
    const checks = calls.filter(isCheck);
    const failed = checks.filter((c) => !c.ok);
    const recovered = recoveredChecks(checks);
    const checksFailed = failed.length - Object.keys(recovered).length;
    const n = calls.length;
    const summary = kind === "model" && n && r.state !== "pending" && r.state !== "running" ? `${r.line} · ${n} tool call${n === 1 ? "" : "s"}` : r.line;
    return { ...r, title: TITLE[r.key] ?? r.label, kind, calls, checksPassed: checks.length - failed.length, checksFailed, recovered, summary };
  });
}

export function runStatusOf(study: Study): RunStatus {
  switch (study.status) {
    case "failed":
      return "failed";
    case "ready":
    case "clinician_review":
      return "awaiting_review";
    case "signed":
    case "patient_summary_ready":
      return "signed";
    case "shared":
    case "closed":
      return "shared";
    default:
      return "running";
  }
}

/** "run-20261028T142704Z-s-ai2y7": the case's analysis run, named by when it arrived. */
export function runIdOf(study: Study): string {
  const at = tsToMillis(study.createdAt);
  const stamp = at ? new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "") : "pending";
  // The same case id the app shows (caseIdOf), including before the pipeline assigns one.
  return `run-${stamp}-${(study.caseId || derivedCaseId(study.id)).toLowerCase()}`;
}

export function runStats(study: Study, steps: ConsoleStep[], now = Date.now()): RunStats {
  const reached = steps.filter((s) => s.state !== "pending");
  const all = reached.flatMap((s) => s.trace);
  const shared = tsToMillis(study.shares?.[0]?.sentAt);
  const arrived = tsToMillis(study.createdAt);
  return {
    runId: runIdOf(study),
    status: runStatusOf(study),
    // SPEC §3.4: calls across model steps, so the tile equals the rows' "· N tool calls".
    toolCalls: reached.filter((s) => s.kind === "model").reduce((n, s) => n + s.calls.length, 0),
    agentTokens: reached.reduce((n, s) => n + s.tokens, 0),
    agentTimeMs: reached.filter((s) => s.kind === "model").reduce((n, s) => n + (s.ms ?? 0), 0),
    observations: study.findings?.length ?? 0,
    checksPassed: reached.reduce((n, s) => n + s.checksPassed, 0),
    checksFailed: reached.reduce((n, s) => n + s.checksFailed, 0),
    // The radiologist read is a human step too, but not the clinician's.
    clinicianSteps: reached.filter((s) => s.kind === "clinician" && s.key !== "read").length,
    arrivalToSharedMs: shared && arrived ? shared - arrived : null,
    // Only while the run is open: a failed run has stopped, so nothing ticks.
    arrivalToNowMs: !shared && arrived && study.status !== "failed" ? Math.max(0, now - arrived) : null,
    modelCalls: all.filter((t) => t.kind === "model" || isModelCall(t.name)).length,
  };
}

/** Calls per tool name in the run, for the manifest's "×N". */
export function callsByTool(steps: ConsoleStep[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of steps) for (const c of s.calls) out[c.name] = (out[c.name] ?? 0) + 1;
  return out;
}

const STEP_OF: Record<ConsoleAgent["id"], string> = { coordinator: "coordinator", intake: "intake", triage: "triage", prep: "prep", radiologist: "read", summary: "summary" };

/** Whether the agent ran in this run, is running now, or has not run. */
export function agentStatus(agent: ConsoleAgent, steps: ConsoleStep[]): "ran" | "running" | "idle" {
  const step = steps.find((s) => s.key === STEP_OF[agent.id]);
  if (!step || step.state === "pending") return "idle";
  if (step.state === "running") return "running";
  return step.trace.length || step.ms ? "ran" : "idle";
}

/** "7,720": thousands separated by commas. */
export function thin(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "31.9 s", "831 ms". */
export function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** "24:21 mins" (m:ss), "1:02:06 hrs" past an hour. */
export function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss} hrs` : `${m}:${ss} mins`;
}

export { CONSOLE_AGENTS, CONSOLE_TOOLS };
export { manifestModels, manifestModelsNote } from "@/functions/src/lib/consoleManifest";
