/**
 * E2 · Per-family summaries for a run and the Markdown table for the README.
 * Pure; the public page (E15) shows the same numbers from `evalRuns/{runId}`.
 */
import { EVAL_FAMILIES, FAMILY_LABEL, type EvalFamily, type EvalResult, type EvalRun, type EvalTask, type FamilySummary, type Lane, type TbSummary } from "./types";

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

/** 95% Wilson score interval for k successes in n trials; [0, 0] when n is 0. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

const passed = (r: EvalResult, id: string) => r.criteria.find((c) => c.id === id)?.pass === true;

/**
 * E16 · Screening numbers over the TB tasks that ran (errors are left out of
 * n, and shown per task). Sensitivity: TB films whose tb_flag passed; specificity:
 * normal films whose tb_flag passed (nothing raised).
 */
export function tbSummary(results: EvalResult[], tasks: EvalTask[]): TbSummary | null {
  const isTb = new Map(tasks.map((t) => [t.id, t.expected.tbSuggestive ?? t.film?.label === "tb"]));
  const ran = results.filter((r) => r.family === "tb" && !r.error);
  if (!ran.length) return null;
  const sets = new Set(tasks.filter((t) => t.family === "tb" && ran.some((r) => r.taskId === t.id)).map((t) => t.film?.dataset ?? null));
  const tb = ran.filter((r) => isTb.get(r.taskId));
  const normal = ran.filter((r) => isTb.get(r.taskId) === false);
  const rate = (rs: EvalResult[], id: string) => {
    const graded = rs.filter((r) => r.criteria.some((c) => c.id === id && c.pass !== null));
    return graded.length ? round(graded.filter((r) => passed(r, id)).length / graded.length) : null;
  };
  const k = (rs: EvalResult[]) => rs.filter((r) => passed(r, "tb_flag")).length;
  return {
    dataset: sets.size === 1 ? [...sets][0] : "mixed",
    n: ran.length,
    sensitivity: tb.length ? round(k(tb) / tb.length) : null,
    specificity: normal.length ? round(k(normal) / normal.length) : null,
    sensitivityCi: tb.length ? wilson(k(tb), tb.length) : null,
    specificityCi: normal.length ? wilson(k(normal), normal.length) : null,
    floorRate: rate(tb, "priority_floor"),
    zoneMatchRate: rate(tb, "zone_match"),
    noLeakRate: rate(ran, "no_leak"),
  };
}

export function summarize(results: EvalResult[], tasks: EvalTask[]): Pick<EvalRun, "summary" | "triage" | "tasks" | "tb" | "tbBySplit"> {
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
    tb: tbSummary(results, tasks),
    tbBySplit: tbBySplit(results, tasks),
  };
}

/** E17 · TB numbers per split; null when the run has no TB tasks. */
export function tbBySplit(results: EvalResult[], tasks: EvalTask[]): EvalRun["tbBySplit"] {
  if (!results.some((r) => r.family === "tb")) return null;
  const split = new Map(tasks.map((t) => [t.id, t.split]));
  const of = (s: EvalTask["split"]) => tbSummary(results.filter((r) => split.get(r.taskId) === s), tasks);
  return { heldOut: of("held-out"), tuning: of("tuning") };
}

/** For each family, the newest run (runs newest first) that has results for it. */
export function latestFamilyRuns(runs: readonly EvalRun[]): Partial<Record<EvalFamily, EvalRun>> {
  const out: Partial<Record<EvalFamily, EvalRun>> = {};
  for (const run of runs) for (const f of EVAL_FAMILIES) if (!out[f] && run.summary?.[f]) out[f] = run;
  return out;
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
    lines.push("", "| Triage | Critical sent critical | Abnormal sent urgent or higher | Normal over-triaged | Floor from measurements (view by model): abnormal recall |", "|---|---|---|---|---|");
    for (const r of triaged) {
      lines.push(`| ${r.label} | ${pct(r.triage!.criticalRecall)} | ${pct(r.triage!.abnormalRecall)} | ${pct(r.triage!.overTriage)} | ${pct(r.triage!.floorAbnormalRecall)} |`);
    }
  }
  const screened = runs.filter((r) => r.tb);
  if (screened.length) {
    const ci = (v: [number, number] | null) => (v ? ` (${pct(v[0])}–${pct(v[1])})` : "");
    lines.push("", "| TB screening | Films | Sensitivity (95% CI) | Specificity (95% CI) | TB sent urgent or higher | Zone matched | TB never named |", "|---|---|---|---|---|---|---|");
    for (const r of screened) {
      const t = r.tb!;
      lines.push(`| ${r.label} | ${t.n} | ${pct(t.sensitivity)}${ci(t.sensitivityCi)} | ${pct(t.specificity)}${ci(t.specificityCi)} | ${pct(t.floorRate)} | ${pct(t.zoneMatchRate)} | ${pct(t.noLeakRate)} |`);
    }
  }
  return lines.join("\n");
}
