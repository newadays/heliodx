/**
 * E2 · Per-family summaries for a run and the Markdown table for the README.
 * Pure; the public page (E15) shows the same numbers from `evalRuns/{runId}`.
 */
import { EVAL_FAMILIES, FAMILY_LABEL, type EvalFamily, type EvalResult, type EvalRun, type EvalTask, type FamilySummary, type Lane } from "./types";

const LANES: Lane[] = ["routine", "urgent", "critical"];
const rank = (l: unknown) => LANES.indexOf(l as Lane);

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export function familySummary(results: EvalResult[]): FamilySummary {
  const criteria = results.flatMap((r) => r.criteria).filter((c) => c.pass !== null);
  return {
    tasks: results.length,
    meanScore: round(results.reduce((n, r) => n + r.score, 0) / (results.length || 1)),
    passRate: round(criteria.filter((c) => c.pass).length / (criteria.length || 1)),
    medianLatencyMs: Math.round(median(results.map((r) => r.latencyMs))),
    costPerTaskUsd: round(results.reduce((n, r) => n + r.costUsd, 0) / (results.length || 1)),
  };
}

export function summarize(results: EvalResult[], tasks: EvalTask[]): Pick<EvalRun, "summary" | "triage" | "tasks"> {
  const summary: EvalRun["summary"] = {};
  for (const f of EVAL_FAMILIES) {
    const rs = results.filter((r) => r.family === f);
    if (rs.length) summary[f] = familySummary(rs);
  }
  const lane = new Map(tasks.map((t) => [t.id, t.expected.lane]));
  const triage = results.filter((r) => r.family === "triage" && !r.error);
  const share = (rs: EvalResult[], ok: (r: EvalResult) => boolean) => (rs.length ? round(rs.filter(ok).length / rs.length) : null);
  const critical = triage.filter((r) => lane.get(r.taskId) === "critical");
  const abnormal = triage.filter((r) => lane.get(r.taskId) && lane.get(r.taskId) !== "routine");
  const normal = triage.filter((r) => lane.get(r.taskId) === "routine");
  return {
    tasks: results.length,
    summary,
    triage: triage.length
      ? {
          criticalRecall: share(critical, (r) => r.output.priority === "critical"),
          abnormalRecall: share(abnormal, (r) => rank(r.output.priority) >= rank("urgent")),
          overTriage: share(normal, (r) => r.output.priority !== "routine"),
          floorAbnormalRecall: share(abnormal, (r) => rank(r.output.floor) >= rank("urgent")),
        }
      : null,
  };
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (v: number) => `$${v.toFixed(3)}`;

/** The README table: one row per family and system. */
export function markdownTable(runs: EvalRun[]): string {
  const lines = [
    "| Family | System | Tasks | Mean score | Criteria passed | Median latency | Cost per task |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const f of EVAL_FAMILIES as readonly EvalFamily[]) {
    for (const run of runs) {
      const s = run.summary[f];
      if (!s) continue;
      lines.push(`| ${FAMILY_LABEL[f]} | ${run.label} | ${s.tasks} | ${pct(s.meanScore)} | ${pct(s.passRate)} | ${secs(s.medianLatencyMs)} | ${usd(s.costPerTaskUsd)} |`);
    }
  }
  const triaged = runs.filter((r) => r.triage);
  if (triaged.length) {
    lines.push("", "| Triage | Critical sent critical | Abnormal sent urgent or higher | Normal over-triaged | Measurements alone: abnormal recall |", "|---|---|---|---|---|");
    for (const r of triaged) {
      lines.push(`| ${r.label} | ${pct(r.triage!.criticalRecall)} | ${pct(r.triage!.abnormalRecall)} | ${pct(r.triage!.overTriage)} | ${pct(r.triage!.floorAbnormalRecall)} |`);
    }
  }
  return lines.join("\n");
}
