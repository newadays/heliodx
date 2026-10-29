/**
 * B22 · Expected analysis time per organization: the median of the last runs
 * (queued → ready), shown as "usually under 0:30" instead of a constant.
 * Kept in `analysisStats/{orgId}`, written by the pipeline only.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";

export const KEEP_RUNS = 20;
export const DEFAULT_EXPECTED_MS = 30_000;

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

export async function expectedAnalysisMs(db: Firestore, orgId: string): Promise<number> {
  const snap = await db.collection("analysisStats").doc(orgId).get();
  return median((snap.get("runsMs") as number[] | undefined) ?? []) ?? DEFAULT_EXPECTED_MS;
}

export async function recordAnalysisRun(db: Firestore, orgId: string, ms: number): Promise<void> {
  if (!(ms > 0) || ms > 30 * 60_000) return;
  const ref = db.collection("analysisStats").doc(orgId);
  await db.runTransaction(async (tx) => {
    const runs = ((await tx.get(ref)).get("runsMs") as number[] | undefined) ?? [];
    tx.set(ref, { runsMs: [...runs, Math.round(ms)].slice(-KEEP_RUNS), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
