/** B19 against the Firestore emulator: trace scopes record events per study, best effort. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setTraceStage, traceEvent, traced, traceScope } from "../../src/lib/trace";

let app: App;
let db: Firestore;
beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "heliodx-rules-test-trace" }, `trace-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const events = async (ref: FirebaseFirestore.DocumentReference) =>
  (await ref.collection("trace").orderBy("seq").get()).docs.map((d) => d.data());

describe("trace", () => {
  it("records events in order with the current stage, and waits for writes before returning", async () => {
    const ref = db.collection("studies").doc(`t-${randomUUID()}`);
    const out = await traceScope(ref, "quality_check", async () => {
      traceEvent({ kind: "model", name: "glimmer.chat", model: "glimmer", ms: 120, promptTokens: 900, outputTokens: 40, ok: true, result: "40 tokens out" });
      setTraceStage("classifying");
      await traced("measure_ratio", { measurement: "cardiothoracic_ratio" }, async () => 0.44, (v) => ({ result: `CTR ${v}` }));
      return "done";
    });
    expect(out).toBe("done");
    const e = await events(ref);
    expect(e.map((x) => [x.seq, x.stage, x.kind, x.name, x.ok])).toEqual([
      [1, "quality_check", "model", "glimmer.chat", true],
      [2, "classifying", "tool", "measure_ratio", true],
    ]);
    expect(e[1].result).toBe("CTR 0.44");
    expect(typeof e[1].ms).toBe("number");
    expect("overlayPath" in e[1]).toBe(false);
  });

  it("records a failed tool call and rethrows", async () => {
    const ref = db.collection("studies").doc(`t-${randomUUID()}`);
    await expect(
      traceScope(ref, "detecting", () => traced("segment_region", { label: "heart" }, async () => { throw new TypeError("boom"); }, () => ({ result: "x" }))),
    ).rejects.toThrow("boom");
    const [e] = await events(ref);
    expect(e).toMatchObject({ name: "segment_region", ok: false, result: "TypeError" });
  });

  it("does nothing outside a scope", () => {
    expect(() => traceEvent({ kind: "check", name: "noop", ok: true })).not.toThrow();
  });
});
