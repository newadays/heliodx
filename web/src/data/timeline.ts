/**
 * The console's run model (design/agent-console SPEC §2–§4), from
 * utils/consoleRun.ts: one set of steps and statistics for both surfaces,
 * plus the export both "Export" buttons download.
 */
import type { Study } from "@/types/study";
import { callsByTool, CONSOLE_AGENTS, CONSOLE_TOOLS, consoleSteps, runIdOf, runStats, type ConsoleStep, type RunStats } from "@/utils/consoleRun";

import { caseIdOf, patientOf, studyLabel } from "./model";

export type StageRow = ConsoleStep;
export const stageRows = consoleSteps;
export { runStats };
export type { RunStats };

/** `HelioDX-<caseId>-trace.json`: the manifest, the statistics and every step with its calls. */
export function runExport(study: Study, steps: ConsoleStep[], stats: RunStats): Record<string, unknown> {
  const counts = callsByTool(steps);
  return {
    runId: runIdOf(study),
    caseId: caseIdOf(study),
    // §4.11: the export carries the source; an upload's original file name is never stored or exported.
    source: study.source,
    patient: patientOf(study).displayName,
    study: studyLabel(study),
    status: stats.status,
    manifest: {
      agents: CONSOLE_AGENTS.map(({ stages: _stages, ...a }) => a),
      tools: CONSOLE_TOOLS.map((t) => ({ ...t, callsInRun: counts[t.name] ?? 0 })),
    },
    stats,
    trace: steps.map(({ trace: entries, calls: _calls, ...s }) => ({ ...s, entries })),
  };
}
