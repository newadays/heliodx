/** B19/W10 against the Firestore emulator: prompts and raw answers are kept for demo studies only. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { traceEvent, traceScope } from "../../src/lib/trace";

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

async function record(orgId: string) {
  const ref = db.collection("studies").doc();
  await ref.set({ orgId });
  await traceScope(ref, "detecting", async () => {
    traceEvent({ kind: "model", name: "glimmer.chat", ok: true, result: "12 tokens out", detail: { prompt: "Describe the film.", raw: '{"proposed":[]}' } });
  });
  return (await ref.collection("trace").get()).docs.map((d) => d.data());
}

describe("trace detail", () => {
  it("keeps the prompt and raw answer for demo studies", async () => {
    const [e] = await record("demo");
    expect(e.detail).toEqual({ prompt: "Describe the film.", raw: '{"proposed":[]}' });
    expect(e.result).toBe("12 tokens out");
  });

  it("drops them for every real organization", async () => {
    const [e] = await record("kubi-medical");
    expect(e.detail).toBeUndefined();
    expect(e.name).toBe("glimmer.chat");
  });
});
