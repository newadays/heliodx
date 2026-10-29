/**
 * The console's stage timeline and totals (SPEC §4.8, §4.9, §5.7), built on
 * `buildTimeline` (utils/caseTimeline.ts), shared with the Done screen.
 */
import type { Study, TraceEntry } from "@/types/study";
import { buildTimeline, type TimelineRow } from "@/utils/caseTimeline";
import { tsToMillis } from "@/utils/millis";

export type { TimelineRow };

const DISPLAY: Record<string, string> = { summary: "Patient note" };

export interface StageRow extends TimelineRow {
  title: string;
  kind: "system" | "model" | "clinician";
}

export function stageRows(study: Study, trace: TraceEntry[], now = Date.now()): StageRow[] {
  return buildTimeline(study, trace, now).map((r) => ({
    ...r,
    title: DISPLAY[r.key] ?? r.label,
    kind: r.state === "human" ? "clinician" : r.key === "received" ? "system" : "model",
  }));
}

export interface TraceTotals {
  agentTimeMs: number;
  tokens: number;
  modelSteps: number;
  clinicianSteps: number;
  arrivalToSharedMs: number | null;
}

export function traceTotals(study: Study, rows: StageRow[]): TraceTotals {
  const reached = rows.filter((r) => r.state !== "pending");
  const model = reached.filter((r) => r.kind === "model");
  const shared = tsToMillis(study.shares?.[0]?.sentAt);
  const arrived = tsToMillis(study.createdAt);
  return {
    agentTimeMs: model.reduce((n, r) => n + (r.ms ?? 0), 0),
    tokens: reached.reduce((n, r) => n + r.tokens, 0),
    modelSteps: model.filter((r) => r.state !== "running").length,
    clinicianSteps: reached.filter((r) => r.kind === "clinician").length,
    arrivalToSharedMs: shared && arrived ? shared - arrived : null,
  };
}
