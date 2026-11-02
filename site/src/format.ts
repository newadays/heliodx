/**
 * E18 · Pure helpers: number formats, the interval bar, and the task list's
 * filters and order. Tested in format.test.ts.
 */
import { EVAL_FAMILIES, FAMILY_LABEL, type EvalFamily } from "@/functions/src/eval/types";
import type { PublicResults, PublicSystemId, PublicTask } from "@/functions/src/eval/publicSchema";

export const SYSTEM_ORDER: PublicSystemId[] = ["helio", "medgemma"];
export const SHORT_NAME: Record<PublicSystemId, string> = { helio: "HelioDX", medgemma: "MedGemma 27B" };

export const pct = (v: number | null | undefined, digits = 1): string => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`);
export const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
export const usd = (v: number): string => `$${v.toFixed(3)}`;

/** Left offset and width (both %) of a 95% interval on a 0–100% track, and the point. */
export function intervalBar(value: number | null, ci: [number, number] | null): { left: number; width: number; point: number | null } | null {
  if (!ci) return null;
  const clamp = (v: number) => Math.max(0, Math.min(100, v * 100));
  const lo = clamp(Math.min(ci[0], ci[1]));
  const hi = clamp(Math.max(ci[0], ci[1]));
  return { left: lo, width: Math.max(hi - lo, 0.5), point: value === null ? null : clamp(value) };
}

export const familyLabel = (f: EvalFamily): string => FAMILY_LABEL[f];

/** Families in the file's order, with counts, for the tabs. */
export function familyCounts(tasks: readonly PublicTask[]): { id: EvalFamily; label: string; count: number }[] {
  return EVAL_FAMILIES.map((id) => ({ id, label: FAMILY_LABEL[id], count: tasks.filter((t) => t.family === id).length })).filter((f) => f.count > 0);
}

export interface TaskFilter {
  family: EvalFamily | null;
  q: string;
  grading: "all" | "deterministic" | "agent";
}

export function readFilter(params: URLSearchParams): TaskFilter {
  const family = params.get("family");
  const grading = params.get("grading");
  return {
    family: (EVAL_FAMILIES as readonly string[]).includes(family ?? "") ? (family as EvalFamily) : null,
    q: params.get("q") ?? "",
    grading: grading === "deterministic" || grading === "agent" ? grading : "all",
  };
}

export function filterTasks(tasks: readonly PublicTask[], f: TaskFilter, systems: PublicResults["systems"]): PublicTask[] {
  const q = f.q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (f.family && t.family !== f.family) return false;
    if (f.grading !== "all" && !t.criteria.some((c) => c.method === f.grading)) return false;
    if (!q) return true;
    const models = Object.keys(t.perSystem).flatMap((id) => {
      const s = systems.find((x) => x.id === id);
      return s ? [s.label, s.model] : [];
    });
    return [t.title, t.id, FAMILY_LABEL[t.family], ...t.tags, ...models].some((v) => v.toLowerCase().includes(q));
  });
}

/** The task after `id` in the filtered list, or null at the end. */
export function nextTask(list: readonly PublicTask[], id: string): PublicTask | null {
  const i = list.findIndex((t) => t.id === id);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}

/** "Graded in code" for deterministic-only tasks. */
export function gradingText(t: PublicTask): string {
  const methods = new Set(t.criteria.map((c) => c.method));
  if (methods.size === 1 && methods.has("deterministic")) return "Graded in code";
  if (methods.has("agent")) return "Code and agent graded";
  return "Clinician graded";
}

/** How many criteria passed for one system's run of a task. */
export function passedCount(t: PublicTask, system: PublicSystemId): { passed: number; total: number } | null {
  const run = t.perSystem[system];
  if (!run) return null;
  const graded = t.criteria.filter((c) => run.criteria[c.id] !== null && run.criteria[c.id] !== undefined);
  return { passed: graded.filter((c) => run.criteria[c.id] === true).length, total: t.criteria.length };
}

/** The query string with one key set or removed ("" when nothing is left). */
export function withParam(search: string, key: string, value: string | null): string {
  const next = new URLSearchParams(search);
  if (value) next.set(key, value);
  else next.delete(key);
  const out = next.toString();
  return out ? `?${out}` : "";
}
