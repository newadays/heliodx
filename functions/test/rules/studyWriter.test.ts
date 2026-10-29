/**
 * StudyWriter against the Firestore emulator (Admin SDK, rules bypassed):
 * transactions, run ownership and the audit trail.
 */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WrongStateError } from "../../src/study/stateMachine";
import { StudyWriter } from "../../src/study/writer";
import { ORG_A, PROJECT_ID, studyShell, UID_A1 } from "./helpers";

let app: App;
let db: Firestore;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  // Own project id: the rules suites clear their project's data between tests.
  app = initializeApp({ projectId: `${PROJECT_ID}-writer` }, `writer-${randomUUID()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function newStudy(status = "queued") {
  const ref = db.collection("studies").doc(`w-${randomUUID()}`);
  await ref.set({ ...studyShell(ORG_A, UID_A1), status });
  return ref;
}

async function audit(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.collection("audit").get();
  return snap.docs.map((d) => d.data()).sort((a, b) => a.at.toMillis() - b.at.toMillis());
}

describe("StudyWriter", () => {
  it("claims a queued study into quality_check and audits it", async () => {
    const ref = await newStudy();
    expect(await new StudyWriter(ref, "pipeline", "run-1").claim()).toEqual({ started: true, reason: "ok" });
    const snap = await ref.get();
    expect(snap.get("status")).toBe("quality_check");
    expect(snap.get("pipeline.runId")).toBe("run-1");
    const entries = await audit(ref);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: "pipeline", action: "pipeline_started", from: "queued", to: "quality_check", runId: "run-1" });
  });

  it("lets exactly one of two racing claims win", async () => {
    const ref = await newStudy();
    const results = await Promise.all([
      new StudyWriter(ref, "pipeline", "run-a").claim(),
      new StudyWriter(ref, "pipeline", "run-b").claim(),
    ]);
    expect(results.filter((r) => r.started)).toHaveLength(1);
    expect(await audit(ref)).toHaveLength(1);
  });

  it("ignores a redelivered event for the same run", async () => {
    const ref = await newStudy();
    const w = new StudyWriter(ref, "pipeline", "run-1");
    await w.claim();
    expect(await w.claim()).toEqual({ started: false, reason: "duplicate_event" });
  });

  it("walks the pipeline and writes one audit entry per status change", async () => {
    const ref = await newStudy();
    const w = new StudyWriter(ref, "pipeline", "run-1");
    await w.claim();
    for (const s of ["classifying", "detecting", "summarizing", "ready"] as const) await w.advance(s);
    expect((await ref.get()).get("status")).toBe("ready");
    expect((await audit(ref)).map((e) => e.to)).toEqual(["quality_check", "classifying", "detecting", "summarizing", "ready"]);
  });

  it("refuses an illegal move and writes nothing", async () => {
    const ref = await newStudy("ready");
    const w = new StudyWriter(ref, { uid: UID_A1 });
    await expect(w.advance("shared")).rejects.toBeInstanceOf(WrongStateError);
    expect((await ref.get()).get("status")).toBe("ready");
    expect(await audit(ref)).toHaveLength(0);
  });

  it("stops a stale run from writing once another run owns the study", async () => {
    const ref = await newStudy();
    const old = new StudyWriter(ref, "pipeline", "run-old");
    await old.claim();
    await new StudyWriter(ref, { uid: UID_A1 }).requeue({ action: "retry_requested" });
    await new StudyWriter(ref, "pipeline", "run-new").claim();
    await expect(old.advance("classifying")).rejects.toBeInstanceOf(WrongStateError);
    await expect(old.patch({ findings: [] }, { allowedIn: ["quality_check"] })).rejects.toBeInstanceOf(WrongStateError);
    expect((await ref.get()).get("pipeline.runId")).toBe("run-new");
  });

  it("records a failure with its code, and a requeue with an attempt count", async () => {
    const ref = await newStudy();
    const w = new StudyWriter(ref, "pipeline", "run-1");
    await w.claim();
    expect(await w.retryLater({ code: "model_unavailable", message: "GPU cold", at: "quality_check" })).toBe("requeue");
    let snap = await ref.get();
    expect(snap.get("status")).toBe("queued");
    expect(snap.get("pipeline.attempts")).toBe(1);
    expect(snap.get("pipeline.lastError.code")).toBe("model_unavailable");

    const w2 = new StudyWriter(ref, "pipeline", "run-2");
    await w2.claim();
    await w2.fail({ code: "quality_rejected", message: "blurred", at: "quality_check" });
    snap = await ref.get();
    expect(snap.get("status")).toBe("failed");
    expect(snap.get("pipeline.error")).toEqual({ code: "quality_rejected", message: "blurred", at: "quality_check" });
    const last = (await audit(ref)).at(-1)!;
    expect(last).toMatchObject({ action: "pipeline_failed", to: "failed", code: "quality_rejected" });
  });

  it("only patches in the allowed statuses and never puts clinical text in the audit", async () => {
    const ref = await newStudy("ready");
    const w = new StudyWriter(ref, { uid: UID_A1 });
    await w.patch({ clinicianSummary: { findings: "Patchy opacity" } }, { allowedIn: ["ready"], action: "summaries_regenerated_both" });
    await expect(w.patch({ clinicianSummary: null }, { allowedIn: ["signed"] })).rejects.toBeInstanceOf(WrongStateError);
    const entries = await audit(ref);
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe(`user:${UID_A1}`);
    expect(JSON.stringify(entries)).not.toContain("opacity");
  });
});
