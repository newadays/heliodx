/**
 * Card B19 · The judges' console case page, as data: one row per stage from
 * the study document, its audit entries and its trace. Pure, so the stage
 * mapping, durations, tokens, greyed rows and the "critical" stage are
 * unit-tested; the console components only render rows.
 *
 * Lines are built from numbers, counts and the trace's one-line results;
 * the console never shows clinical free text.
 */
import type { Study, StudyStatus, TraceEntry } from "@/types/study";
import { slaBudgetMs } from "@/functions/src/lib/sla";
import { readRequirement, READ_REASON_TEXT } from "@/functions/src/radiology/gate";
import { tsToMillis } from "@/utils/millis";
import { receivedLine } from "@/utils/studySource";

export type RowState = "done" | "critical" | "human" | "running" | "pending" | "failed";

export interface TimelineRow {
  key: string;
  label: string;
  /** Agent chip, or "Clinician" for human steps. */
  agent: string;
  /** Model chips from the trace (e.g. "Glimmer", "SAM 3.1"). */
  models: string[];
  state: RowState;
  /** Epoch ms, 0 when not reached. */
  at: number;
  /** Stage duration in ms, null when unknown. */
  ms: number | null;
  tokens: number;
  line: string;
  trace: TraceEntry[];
}

const MODEL_LABEL: Record<string, string> = { glimmer: "Glimmer", "sam-3.1": "SAM 3.1", "muse-wonder-1.0": "Muse Wonder", "muse-voice-transcribe-1.0": "Muse Voice Transcribe", mock: "Mock" };

export function modelLabel(model: string): string {
  return MODEL_LABEL[model] ?? model;
}

const ORDER: StudyStatus[] = [
  "uploading",
  "queued",
  "quality_check",
  "classifying",
  "detecting",
  "summarizing",
  "ready",
  "clinician_review",
  "signed",
  "patient_summary_ready",
  "shared",
  "closed",
];

const rank = (s: StudyStatus) => ORDER.indexOf(s);

interface StageDef {
  key: string;
  label: string;
  agent: string;
  /** Trace stages whose events belong to this row. */
  traceStages: string[];
  /** Status that marks the row as reached; its step timestamp is the row time. */
  enters: StudyStatus;
  /** Status that ends the row (for duration). */
  exits: StudyStatus | null;
  human?: boolean;
  pending: string;
}

const STAGES: StageDef[] = [
  { key: "received", label: "Received", agent: "Upload", traceStages: ["received"], enters: "queued", exits: "quality_check", pending: "Waiting for the image." },
  { key: "intake", label: "Intake", agent: "Intake", traceStages: ["quality_check"], enters: "quality_check", exits: "classifying", pending: "Not started." },
  { key: "triage", label: "Triage", agent: "Triage", traceStages: ["classifying"], enters: "classifying", exits: "detecting", pending: "Waits for intake." },
  { key: "prep", label: "Prep", agent: "Prep", traceStages: ["detecting", "summarizing"], enters: "detecting", exits: "ready", pending: "Waits for triage." },
  { key: "coordinator", label: "Coordinator", agent: "Coordinator", traceStages: ["coordination"], enters: "queued", exits: null, pending: "Plans the case once its draft is ready, and escalates it if it stalls or runs past its SLA." },
  { key: "read", label: "Radiologist read", agent: "Radiologist", traceStages: ["radiology"], enters: "ready", exits: null, pending: "Not required for this case." },
  { key: "signed", label: "Signed", agent: "Clinician", traceStages: ["reset", "dictation", "signed"], enters: "signed", exits: null, human: true, pending: "Waiting for the clinician to review and sign." },
  { key: "summary", label: "Patient summary", agent: "Summary", traceStages: ["patient_summary"], enters: "patient_summary_ready", exits: null, pending: "Written after signing, from the signed report." },
  { key: "shared", label: "Shared", agent: "Clinician", traceStages: ["sharing"], enters: "shared", exits: null, human: true, pending: "Shared only after every next step is confirmed and the patient consents." },
];

function stepAt(study: Study, status: StudyStatus): number {
  return tsToMillis(study.pipeline?.stepTimestamps?.[status]);
}

function reachedRank(study: Study): number {
  if (study.status === "failed") {
    const at = study.pipeline?.error?.at;
    return at ? rank(at) : rank("queued");
  }
  return rank(study.status);
}

function lineFor(def: StageDef, study: Study, trace: TraceEntry[]): string {
  const result = (name: string) => trace.find((t) => t.name === name)?.result;
  switch (def.key) {
    case "received": {
      // §4.11: samples and uploads read differently; phone-app studies keep the older line.
      if (study.source === "sample" || study.source === "upload") return receivedLine(study);
      const d = study.details ?? study.demo;
      const who = d?.age && d?.sex ? `${d.age}${d.sex}` : null;
      return [study.studyType || "Image", who, d?.indication ? `indication: ${d.indication}` : null, `from ${study.source}`].filter(Boolean).join(" · ");
    }
    case "intake": {
      const q = result("measure_quality");
      const segs = trace.filter((t) => t.name === "segment_region");
      const found = segs.filter((t) => t.ok).length;
      return [q ? `Quality ${q}` : study.pipeline?.quality ? `Quality ${study.pipeline.quality.ok ? "pass" : "retake needed"}` : null, segs.length ? `${found}/${segs.length} regions segmented` : null]
        .filter(Boolean)
        .join(". ") || "Image checked.";
    }
    case "triage": {
      const priority = study.priority ?? study.triage?.priority;
      const exceeded = trace.filter((t) => t.kind === "check" && /exceeded/.test(t.result ?? "")).map((t) => (t.result ?? "").replace(/ · exceeded.*$/, " exceeded"));
      const within = trace.filter((t) => t.kind === "check" && /within limits/.test(t.result ?? "")).map((t) => (t.result ?? "").replace(/ · threshold [^·]+ · within limits$/, " within limits"));
      const parts = [priority ? `Priority ${priority}.` : null, [...exceeded, ...within].join("; ") || null];
      return parts.filter(Boolean).join(" ") || "Measurements taken.";
    }
    case "prep": {
      const obs = (study.findings ?? []).length;
      const meas = (study.measurements ?? []).length;
      const overlays = trace.filter((t) => t.name === "render_overlay").length || Object.keys((study.pipeline as { overlays?: Record<string, string> })?.overlays ?? {}).length;
      return `Draft ready: ${obs} proposed observation${obs === 1 ? "" : "s"}, ${meas} measurement${meas === 1 ? "" : "s"}, ${overlays} overlay${overlays === 1 ? "" : "s"}.`;
    }
    case "signed": {
      const f = study.findings ?? [];
      const n = (s: string) => f.filter((x) => x.status === s).length;
      const by = study.signed?.name ? ` Signed by ${study.signed.name}.` : "";
      return `${n("accepted")} accepted, ${n("edited")} edited, ${n("rejected")} rejected.${by}`;
    }
    case "coordinator":
      // B13: each decision's one-line reason, in order ("(rules)" when the fallback decided).
      return trace.map((t) => `${t.name === "plan_study" ? "Planned" : t.name === "requeue_study" ? "Requeued" : "Escalated"}: ${t.result ?? ""}`).join(" · ") || "No decisions yet.";
    case "summary":
      return result("map_next_steps") ?? (study.patientSummary ? `${study.patientSummary.nextSteps?.length ?? 0} next steps.` : "Written.");
    case "shared": {
      const shares = study.shares ?? [];
      const last = shares[shares.length - 1];
      const how = last ? (last.channel === "pdf" ? "PDF" : last.channel === "whatsapp" ? "WhatsApp" : "Email") : "";
      return last ? `${shares.length} share${shares.length === 1 ? "" : "s"} · ${how} · consent ${last.consent?.given ? "recorded" : "not recorded"}` : "Shared.";
    }
    default:
      return "";
  }
}

export function buildTimeline(study: Study, trace: TraceEntry[], now: number = Date.now()): TimelineRow[] {
  const reached = reachedRank(study);
  const sorted = [...trace].sort((a, b) => a.seq - b.seq || tsToMillis(a.at) - tsToMillis(b.at));
  return STAGES.map((def) => {
    const rows = sorted.filter((t) => def.traceStages.includes(t.stage));
    const isReached = reached >= rank(def.enters) && (study.status !== "failed" || rank(def.enters) <= reached);
    if (def.key === "read") return readRow(def, study, rows);
    if (def.key === "coordinator") {
      // Decided by the coordinator tick at any stage (plan, requeue, escalate): shown once it has acted.
      return {
        key: def.key,
        label: def.label,
        agent: def.agent,
        models: [...new Set(rows.map((t) => t.model).filter((m): m is string => !!m))].map(modelLabel),
        state: (rows.length ? (rows.some((t) => t.name === "escalate_to_human") ? "critical" : "done") : "pending") as RowState,
        at: rows.length ? tsToMillis(rows[0].at) : 0,
        ms: null,
        tokens: 0,
        line: rows.length ? lineFor(def, study, rows) : def.pending,
        trace: rows,
      };
    }
    let at = def.key === "received" ? tsToMillis(study.createdAt) : stepAt(study, def.enters);
    if (def.key === "signed") at = tsToMillis(study.signed?.at) || at;
    if (def.key === "shared") at = tsToMillis(study.shares?.[0]?.sentAt) || at;
    const end = def.exits ? stepAt(study, def.exits) : 0;
    const traceMs = rows.reduce((n, t) => n + (t.ms ?? 0), 0);
    const ms = at && end && end >= at ? end - at : traceMs || null;
    const tokens = rows.reduce((n, t) => n + (t.promptTokens ?? 0) + (t.outputTokens ?? 0), 0);
    const models = [...new Set(rows.map((t) => t.model).filter((m): m is string => !!m))].map(modelLabel);

    let state: RowState;
    if (study.status === "failed" && study.pipeline?.error?.at && def.traceStages.includes(study.pipeline.error.at)) state = "failed";
    else if (!isReached) state = "pending";
    else if (def.human) state = "human";
    else if (def.key === "triage" && (study.priority ?? study.triage?.priority) === "critical") state = "critical";
    else if (def.exits && !stepAt(study, def.exits) && study.status !== "failed") state = "running";
    else state = "done";

    const line =
      state === "pending"
        ? def.pending
        : state === "failed"
          ? `Stopped: ${study.pipeline?.error?.code ?? "error"}.`
          : state === "running"
            ? `In progress for ${Math.max(0, Math.round((now - at) / 1000))} s.`
            : lineFor(def, study, rows);

    const agent = def.key === "received" && study.source === "sample" ? "Sample" : def.agent;
    return { key: def.key, label: def.label, agent, models, state, at: isReached ? at : 0, ms: state === "pending" ? null : ms, tokens, line, trace: rows };
  });
}

/**
 * B14 · The radiologist read: running while a simulated reader has it, a
 * human step once signed. Before any read, says whether the gate requires one.
 */
function readRow(def: StageDef, study: Study, rows: TraceEntry[]): TimelineRow {
  const read = study.radiologistRead;
  const base = { key: def.key, label: def.label, agent: read ? `${read.assigneeName} (simulated)` : def.agent, models: [], ms: null, tokens: 0, trace: rows };
  if (!read) {
    const gate = rank(study.status) < rank("signed") ? readRequirement(study) : null;
    return { ...base, state: "pending", at: 0, line: gate ? `Required: ${READ_REASON_TEXT[gate.reason]}. Not requested yet.` : def.pending };
  }
  const at = tsToMillis(read.assignedAt);
  const signedAt = tsToMillis(read.signedAt);
  const start = tsToMillis(rows[0]?.at) || at;
  const line = rows.map((t) => t.result ?? "").filter(Boolean).join(" · ") || (read.status === "signed" ? `Signed · ${read.note ?? ""}` : "Assigned.");
  return { ...base, state: read.status === "signed" ? "human" : "running", at: start, ms: signedAt && start ? signedAt - start : null, line };
}

/** "9.4 s · 3,180 tok" */
export function formatCost(ms: number | null, tokens: number): string {
  const parts: string[] = [];
  if (ms !== null) parts.push(ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  if (tokens) parts.push(`${tokens.toLocaleString("en-US")} tok`);
  return parts.join(" · ");
}

/** Short case id, e.g. "C7F3A". */
export function caseId(studyId: string): string {
  return `C${studyId.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase()}`;
}

/** "critical · 3:48 left" for a 5-minute critical SLA, urgent 30 min; null for routine or once signed. */
export function slaLabel(study: Study, now: number): { text: string; level: "critical" | "urgent" } | null {
  const p = study.priority;
  if (!p || p === "routine" || rank(study.status) >= rank("signed")) return null;
  const start = stepAt(study, "detecting") || tsToMillis(study.createdAt);
  if (!start) return null;
  // The coordinator's budget (B13): the priority before it planned the study.
  const budget = slaBudgetMs(study.coordinator?.fromPriority ?? p) ?? 0;
  const left = start + budget - now;
  const abs = Math.abs(left);
  const mm = Math.floor(abs / 60_000);
  const ss = String(Math.floor((abs % 60_000) / 1000)).padStart(2, "0");
  return { text: left >= 0 ? `${p} · ${mm}:${ss} left` : `${p} · ${mm}:${ss} over`, level: p };
}
