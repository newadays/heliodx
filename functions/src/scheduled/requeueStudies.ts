/**
 * The sweeper: every two minutes, restart studies the pipeline is not
 * working on but should be (often studies waiting for a cold GPU).
 *
 *  - `queued` and idle for 1+ minute: requeued after a transient failure
 *    (model service down, cold or slow), or an upload whose trigger never
 *    ran. Re-run while automatic attempts remain.
 *  - Stuck mid-run (a running status, idle for 10+ minutes): the function
 *    running it died or timed out. Counted as a transient `timeout`, so it is
 *    requeued or failed by the same rule.
 *
 * Event ids are deterministic per study, attempt count and last update, so
 * two overlapping sweeps start one run, not two (StudyWriter.claim), while a
 * study that went back to the queue without using an attempt (waiting for a
 * cold GPU) still gets a new run on the next sweep.
 */
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { REGION } from "../config";
import { MAX_ATTEMPTS } from "../pipeline/retryPolicy";
import { runPipeline, type StudyForPipeline } from "../pipeline/run";
import { RUNNING_STATUSES, WrongStateError } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";

export const QUEUED_IDLE_MS = 60 * 1000;
export const STUCK_IDLE_MS = 10 * 60 * 1000;
/** Runs per sweep. Each real run takes about a minute on the GPU. */
export const SWEEP_LIMIT = 5;

export interface SweepResult {
  rerun: string[];
  rescued: string[];
  skipped: { studyId: string; reason: string }[];
}

/** Same inputs give the same id; any requeue (which bumps updatedAt) gives a new one. */
export function sweepEventId(studyId: string, attempts: number, updatedAt: { toMillis(): number } | null | undefined): string {
  return `requeue:${studyId}:${attempts}:${updatedAt?.toMillis() ?? 0}`;
}

type Runner = (ref: DocumentReference, study: StudyForPipeline, eventId: string) => Promise<void>;

/** One sweep. `run` is injected so tests can observe without running the pipeline. */
export async function sweepStudies(db: Firestore, nowMs: number, run: Runner, limit = SWEEP_LIMIT): Promise<SweepResult> {
  const result: SweepResult = { rerun: [], rescued: [], skipped: [] };

  // 1. Rescue studies stuck mid-run: back to the queue (or failed) first.
  const stuck = await db
    .collection("studies")
    .where("status", "in", [...RUNNING_STATUSES])
    .where("updatedAt", "<=", Timestamp.fromMillis(nowMs - STUCK_IDLE_MS))
    .orderBy("updatedAt")
    .limit(limit)
    .get();
  for (const doc of stuck.docs) {
    try {
      // No runId: the dead run no longer owns anything worth protecting.
      const outcome = await new StudyWriter(doc.ref, "scheduler").retryLater({
        code: "timeout",
        message: "The analysis stopped responding.",
        at: doc.get("status"),
      });
      result.rescued.push(doc.id);
      logger.warn("sweeper: rescued a stuck study", { studyId: doc.id, outcome });
    } catch (error) {
      result.skipped.push({ studyId: doc.id, reason: error instanceof WrongStateError ? `wrong_state_${error.stage}` : "error" });
    }
  }

  // 2. Re-run queued studies that have been idle, oldest first.
  const queued = await db
    .collection("studies")
    .where("status", "==", "queued")
    .where("updatedAt", "<=", Timestamp.fromMillis(nowMs - QUEUED_IDLE_MS))
    .orderBy("updatedAt")
    .limit(limit)
    .get();

  const runs: Promise<void>[] = [];
  for (const doc of queued.docs) {
    const study = doc.data() as StudyForPipeline & { deletedAt?: unknown; pipeline?: { attempts?: number } };
    const attempts = Number(study.pipeline?.attempts ?? 0);
    if (study.deletedAt) {
      result.skipped.push({ studyId: doc.id, reason: "deleted" });
      continue;
    }
    if (attempts >= MAX_ATTEMPTS) {
      result.skipped.push({ studyId: doc.id, reason: "attempts_exhausted" });
      continue;
    }
    result.rerun.push(doc.id);
    runs.push(run(doc.ref, study, sweepEventId(doc.id, attempts, doc.get("updatedAt"))));
  }
  // Runs are independent; one failing must not stop the others.
  const settled = await Promise.allSettled(runs);
  settled.forEach((s, i) => {
    if (s.status === "rejected") logger.error("sweeper: run threw", { studyId: result.rerun[i] });
  });
  return result;
}

export const requeueStudies = onSchedule(
  { schedule: "every 2 minutes", region: REGION, timeZone: "Etc/UTC", timeoutSeconds: 540, memory: "1GiB", retryCount: 0 },
  async () => {
    const bucket = getStorage().bucket().name;
    const out = await sweepStudies(getFirestore(), Date.now(), (ref, study, eventId) =>
      runPipeline(ref, study, eventId, { bucket }),
    );
    if (out.rerun.length || out.rescued.length || out.skipped.length) {
      logger.info("sweeper: done", { rerun: out.rerun.length, rescued: out.rescued.length, skipped: out.skipped.length });
    }
  },
);
