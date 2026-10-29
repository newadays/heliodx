/**
 * B2 against the Firestore emulator: transient failures requeue with a cap,
 * and the sweeper re-runs idle queued studies and rescues stuck ones.
 */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { QUEUED_IDLE_MS, STUCK_IDLE_MS, sweepStudies } from "../../src/scheduled/requeueStudies";
import { StudyWriter } from "../../src/study/writer";
import { ORG_A, PROJECT_ID, studyShell, UID_A1 } from "./helpers";

let app: App;
let db: Firestore;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: `${PROJECT_ID}-requeue` }, `requeue-${randomUUID()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const all = await db.collection("studies").get();
  await Promise.all(all.docs.map((d) => db.recursiveDelete(d.ref)));
});

async function study(status: string, idleMs: number, extra: Record<string, unknown> = {}) {
  const ref = db.collection("studies").doc(`q-${randomUUID()}`);
  await ref.set({ ...studyShell(ORG_A, UID_A1), status, updatedAt: Timestamp.fromMillis(NOW - idleMs), ...extra });
  return ref;
}

describe("retryLater", () => {
  it("requeues twice, then fails on the third transient failure", async () => {
    const ref = await study("queued", 0);
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const w = new StudyWriter(ref, "pipeline", `run-${i}`);
      await w.claim();
      outcomes.push(await w.retryLater({ code: "model_unavailable", message: "GPU down", at: "quality_check" }));
    }
    expect(outcomes).toEqual(["requeue", "requeue", "fail"]);
    const snap = await ref.get();
    expect(snap.get("status")).toBe("failed");
    expect(snap.get("pipeline.attempts")).toBe(3);
    expect(snap.get("pipeline.error.code")).toBe("model_unavailable");
  });

  it("waits for a cold GPU without using up an attempt, and says so in the audit", async () => {
    const ref = await study("queued", 0, { pipeline: { runId: null, stepTimestamps: {}, attempts: 2 } });
    const w = new StudyWriter(ref, "pipeline", "run-warm");
    await w.claim();
    expect(await w.retryLater({ code: "model_unavailable", message: "starting", at: "quality_check" }, { countAttempt: false })).toBe("requeue");
    const snap = await ref.get();
    expect(snap.get("status")).toBe("queued");
    expect(snap.get("pipeline.attempts")).toBe(2);
    const audit = (await ref.collection("audit").get()).docs.map((d) => d.data().action);
    expect(audit).toContain("pipeline_waiting_for_models");
  });

  it("lets a manual retry reset the count", async () => {
    const ref = await study("failed", 0, { pipeline: { runId: "old", stepTimestamps: {}, attempts: 3 } });
    await new StudyWriter(ref, { uid: UID_A1 }).requeue({ action: "retry_requested", resetAttempts: true });
    const snap = await ref.get();
    expect(snap.get("status")).toBe("queued");
    expect(snap.get("pipeline.attempts")).toBe(0);
  });
});

describe("sweepStudies", () => {
  const recorder = () => {
    const calls: { id: string; eventId: string }[] = [];
    const run = async (ref: DocumentReference, _s: unknown, eventId: string) => {
      calls.push({ id: ref.id, eventId });
    };
    return { calls, run };
  };

  it("re-runs a queued study idle past the threshold, and leaves a fresh one alone", async () => {
    const idle = await study("queued", QUEUED_IDLE_MS + 1_000, { pipeline: { runId: "r", stepTimestamps: {}, attempts: 1 } });
    await study("queued", 10_000);
    const { calls, run } = recorder();
    const out = await sweepStudies(db, NOW, run);
    expect(out.rerun).toEqual([idle.id]);
    const updatedAtMs = ((await idle.get()).get("updatedAt") as Timestamp).toMillis();
    expect(calls).toEqual([{ id: idle.id, eventId: `requeue:${idle.id}:1:${updatedAtMs}` }]);
  });

  it("skips deleted studies and studies out of attempts", async () => {
    await study("queued", QUEUED_IDLE_MS + 1_000, { deletedAt: Timestamp.fromMillis(NOW) });
    await study("queued", QUEUED_IDLE_MS + 1_000, { pipeline: { runId: "r", stepTimestamps: {}, attempts: 3 } });
    const { calls, run } = recorder();
    const out = await sweepStudies(db, NOW, run);
    expect(calls).toHaveLength(0);
    expect(out.skipped.map((s) => s.reason).sort()).toEqual(["attempts_exhausted", "deleted"]);
  });

  it("rescues a study stuck mid-run back to the queue", async () => {
    const stuck = await study("detecting", STUCK_IDLE_MS + 1_000, { pipeline: { runId: "dead", stepTimestamps: {} } });
    const { run } = recorder();
    const out = await sweepStudies(db, NOW, run);
    expect(out.rescued).toEqual([stuck.id]);
    const snap = await stuck.get();
    expect(snap.get("status")).toBe("queued");
    expect(snap.get("pipeline.lastError.code")).toBe("timeout");
  });

  it("does not touch ready, failed or uploading studies", async () => {
    for (const s of ["ready", "failed", "uploading", "signed"]) await study(s, STUCK_IDLE_MS * 2);
    const { calls, run } = recorder();
    const out = await sweepStudies(db, NOW, run);
    expect(calls).toHaveLength(0);
    expect(out.rescued).toHaveLength(0);
  });

  it("gives a study that waited for the GPU without using an attempt a fresh run on the next sweep", async () => {
    const ref = await study("queued", QUEUED_IDLE_MS + 1_000);
    const claimAndWait = async (r: DocumentReference, _s: unknown, eventId: string) => {
      const w = new StudyWriter(r, "pipeline", eventId);
      if ((await w.claim()).started) await w.retryLater({ code: "model_unavailable", message: "starting", at: "quality_check" }, { countAttempt: false });
    };
    await sweepStudies(db, NOW, claimAndWait);
    // Next sweep, well after the requeue: a new event id, so the run starts again.
    const started: boolean[] = [];
    await sweepStudies(db, Date.now() + QUEUED_IDLE_MS * 2, async (r, _s, eventId) => {
      started.push((await new StudyWriter(r, "pipeline", eventId).claim()).started);
    });
    expect(started).toEqual([true]);
    expect((await ref.get()).get("pipeline.attempts") ?? 0).toBe(0);
  });

  it("starts one run when two sweeps overlap", async () => {
    const ref = await study("queued", QUEUED_IDLE_MS + 1_000);
    const started: boolean[] = [];
    const claimOnly = async (r: DocumentReference, _s: unknown, eventId: string) => {
      started.push((await new StudyWriter(r, "pipeline", eventId).claim()).started);
    };
    await Promise.all([sweepStudies(db, NOW, claimOnly), sweepStudies(db, NOW, claimOnly)]);
    expect(started.filter(Boolean)).toHaveLength(1);
    expect((await ref.get()).get("status")).toBe("quality_check");
  });
});
