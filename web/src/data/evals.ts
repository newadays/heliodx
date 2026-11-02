/**
 * E15 · The published evaluation runs, for the public /evals page. No sign-in:
 * `evalRuns` is readable by anyone and written only by `scripts/eval.ts`
 * through the Admin SDK (firestore.rules). Per system and family, the latest
 * published run that covers the family is shown, so a TB-only run (E16) does
 * not hide the other families.
 */
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";

import { latestFamilyRuns } from "@/functions/src/eval/summary";
import type { EvalFamily, EvalResult, EvalRun, EvalSystem } from "@/functions/src/eval/types";
import { db } from "~/firebase";

export const SYSTEMS: EvalSystem[] = ["helio", "medgemma"];

export interface EvalData {
  /** The latest published run per system. */
  runs: Partial<Record<EvalSystem, EvalRun>>;
  /** The run each family's results come from, per system. */
  familyRuns: Partial<Record<EvalSystem, Partial<Record<EvalFamily, EvalRun>>>>;
  /** taskId → result per system, in family, film and variant order (`sortKey`). */
  tasks: { taskId: string; bySystem: Partial<Record<EvalSystem, EvalResult>> }[];
}

const FAMILY_ORDER = ["intake", "triage", "prep", "note", "tb"];
const VARIANT_ORDER = ["clean", "blur", "lowres", "nonmedical"];

/** Family, then film number, then intake variant: "intake-blur-3" sorts after "intake-clean-3", "tb-10" after "tb-9". */
export function sortKey(taskId: string): string {
  const [family, ...rest] = taskId.split("-");
  const n = Number(rest[rest.length - 1]) || 0;
  const variant = rest.length > 1 ? VARIANT_ORDER.indexOf(rest[0]) : 0;
  const f = FAMILY_ORDER.indexOf(family);
  // Non-medical images come after the films.
  const film = variant === 3 ? 900 + n : n;
  return `${f < 0 ? 9 : f}-${String(film).padStart(4, "0")}-${variant}`;
}

/** For each family, the newest published run (runs newest first) that has results for it. */
export function pickFamilyRuns(runs: readonly EvalRun[]): Partial<Record<EvalFamily, EvalRun>> {
  return latestFamilyRuns(runs.filter((r) => r.published));
}

export function useEvalRuns(): { data: EvalData | null; loading: boolean; error: Error | null; retry: () => void } {
  const [state, setState] = useState<{ data: EvalData | null; loading: boolean; error: Error | null }>({ data: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      const snap = await getDocs(query(collection(db, "evalRuns"), orderBy("startedAt", "desc"), limit(20)));
      const all = snap.docs.map((d) => ({ ...(d.data() as EvalRun), id: d.id }));
      const runs: EvalData["runs"] = {};
      const familyRuns: EvalData["familyRuns"] = {};
      for (const system of SYSTEMS) {
        const mine = all.filter((r) => r.system === system && r.published);
        if (!mine.length) continue;
        runs[system] = mine[0];
        familyRuns[system] = pickFamilyRuns(mine);
      }
      const order: string[] = [];
      const byTask = new Map<string, EvalData["tasks"][number]>();
      for (const system of SYSTEMS) {
        const chosen = familyRuns[system] ?? {};
        for (const run of new Set(Object.values(chosen))) {
          const results = await getDocs(collection(db, "evalRuns", run.id, "results"));
          for (const r of results.docs) {
            const result = r.data() as EvalResult;
            // Only the families this run is the latest for.
            if (chosen[result.family]?.id !== run.id) continue;
            if (!byTask.has(result.taskId)) {
              byTask.set(result.taskId, { taskId: result.taskId, bySystem: {} });
              order.push(result.taskId);
            }
            byTask.get(result.taskId)!.bySystem[system] = result;
          }
        }
      }
      order.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
      return { runs, familyRuns, tasks: order.map((id) => byTask.get(id)!) };
    })().then(
      (data) => live && setState({ data, loading: false, error: null }),
      (error: unknown) => live && setState({ data: null, loading: false, error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
