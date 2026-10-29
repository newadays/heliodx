/** B13 against the Firestore emulator: one coordinator tick plans, requeues and escalates, idempotently, with audit and trace rows. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { coordinate, type Planner } from "../../src/coordinator/coordinate";
import { ORG_A, PROJECT_ID, studyShell, UID_A1 } from "./helpers";

let app: App;
let db: Firestore;
const NOW = Date.now();
const MIN = 60_000;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: `${PROJECT_ID}-coordinator` }, `coord-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});
beforeEach(async () => {
  for (const c of ["studies", "system"]) {
    const all = await db.collection(c).get();
    await Promise.all(all.docs.map((d) => db.recursiveDelete(d.ref)));
  }
});

async function study(id: string, extra: Record<string, unknown>): Promise<DocumentReference> {
  const ref = db.collection("studies").doc(id);
  await ref.set({ ...studyShell(ORG_A, UID_A1), status: "ready", priority: "routine", createdAt: Timestamp.fromMillis(NOW - 10 * MIN), updatedAt: Timestamp.fromMillis(NOW - MIN), ...extra });
  return ref;
}
const audit = async (ref: DocumentReference) => (await ref.collection("audit").get()).docs.map((d) => d.data());
const trace = async (ref: DocumentReference) => (await ref.collection("trace").get()).docs.map((d) => d.data());

describe("coordinate", () => {
  it("applies Wonder's plan through the writer, with audit and Muse Wonder trace rows; a second tick does nothing", async () => {
    const ready = await study("ready1", { priority: "urgent" });
    const failed = await study("failed1", { status: "failed", pipeline: { runId: null, stepTimestamps: {}, error: { code: "model_unavailable", message: "x", at: "quality_check" }, attempts: 3 } });
    const planner: Planner = vi.fn(async () => ({
      actions: [
        { action: "plan_study" as const, studyId: "ready1", lane: "routine" as const, radiologistRead: true, reason: "Urgent draft; radiologist read advised." },
        { action: "requeue_study" as const, studyId: "failed1", reason: "Model service failed; retry once." },
      ],
    }));

    const out = await coordinate(db, NOW, { planner });
    expect(out.source).toBe("wonder");
    expect(out.applied.map((a) => `${a.action}:${a.studyId}`)).toEqual(["plan_study:ready1", "requeue_study:failed1"]);

    const r = (await ready.get()).data()!;
    expect(r.priority).toBe("urgent"); // Wonder asked for routine: never lowered
    expect(r.coordinator).toMatchObject({ lane: "urgent", radiologistReadSuggested: true, by: "muse-wonder-1.0" });
    expect(r.radiologistRead).toBeUndefined(); // recorded, not enforced (B14)
    expect(await audit(ready)).toEqual([expect.objectContaining({ action: "coordinator_planned", actor: "coordinator", detail: expect.objectContaining({ source: "wonder" }) })]);
    expect(await trace(ready)).toEqual([expect.objectContaining({ stage: "coordination", name: "plan_study", model: "muse-wonder-1.0", ok: true })]);

    const f = (await failed.get()).data()!;
    expect(f.status).toBe("queued");
    expect(f.pipeline.attempts).toBe(0);
    expect(f.coordinator.requeues).toBe(1);

    const again = await coordinate(db, NOW + MIN, { planner });
    expect(again.applied).toEqual([]);
    expect((await audit(ready)).length).toBe(1);
    expect((await db.collection("system").doc("coordinator").get()).get("source")).toBe("idle");
  });

  it("falls back to the rules when Wonder fails, and still sweeps SLAs", async () => {
    const overdue = await study("overdue1", { priority: "critical", coordinator: { plannedAt: new Date() }, pipeline: { runId: null, stepTimestamps: { detecting: Timestamp.fromMillis(NOW - 12 * MIN) } } });
    const ready = await study("ready2", {});
    const out = await coordinate(db, NOW, {
      planner: async () => {
        throw new Error("Model API returned HTTP 503");
      },
    });
    expect(out.source).toBe("rules");
    expect(out.error).toMatch(/503/);
    const o = (await overdue.get()).data()!;
    expect(o.flags.needsHuman).toBe(true);
    expect(o.coordinator.escalation).toMatchObject({ by: "rules" });
    expect(o.coordinator.escalation.reason).toMatch(/past its SLA/);
    expect((await trace(overdue))[0]).toMatchObject({ name: "escalate_to_human", ok: true });
    expect((await trace(overdue))[0].model).toBeUndefined();
    expect((await ready.get()).get("coordinator.plannedAt")).toBeTruthy();
  });

  it("does not call Wonder when nothing needs a decision", async () => {
    await study("planned", { coordinator: { plannedAt: new Date() } });
    await study("running", { status: "detecting" });
    const planner = vi.fn();
    const out = await coordinate(db, NOW, { planner: planner as unknown as Planner });
    expect(out.source).toBe("idle");
    expect(planner).not.toHaveBeenCalled();
  });

  it("adds the SLA sweep to Wonder's plan when Wonder misses an overdue case", async () => {
    const overdue = await study("overdue2", { priority: "urgent", coordinator: { plannedAt: new Date() }, pipeline: { runId: null, stepTimestamps: { detecting: Timestamp.fromMillis(NOW - 45 * MIN) } } });
    await coordinate(db, NOW, { planner: async () => ({ actions: [] }) });
    expect((await overdue.get()).get("flags.needsHuman")).toBe(true);
  });
});
