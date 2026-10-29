/** B18 against the Firestore emulator: the dictate callable's checks, and that only "dictation was used" is recorded, never the text. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dictateCore } from "../../src/callables/dictate";
import { DictationUnavailable } from "../../src/models/transcribe";
import { wav } from "../fixtures/wav";
import { ORG_A, studyShell, UID_A1, UID_B1 } from "./helpers";

let app: App;
let db: Firestore;
beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: `heliodx-rules-test-dictate` }, `dictate-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

async function study(status = "ready") {
  const ref = db.collection("studies").doc(`dict-${randomUUID()}`);
  await ref.set({ ...studyShell(ORG_A, UID_A1), status });
  return ref;
}
const audio = wav(32_000).toString("base64");
const said = "Small right pleural effusion.";

describe("dictateCore", () => {
  it("returns the transcript and records only that dictation was used, and for how long", async () => {
    const ref = await study();
    const out = await dictateCore(db, UID_A1, { studyId: ref.id, audio }, { transcribe: async () => ({ transcript: said, ms: 900 }) });
    expect(out).toEqual({ transcript: said });
    const audit = (await ref.collection("audit").get()).docs.map((d) => d.data());
    expect(audit).toMatchObject([{ actor: UID_A1, action: "dictation_used", detail: { seconds: 2 } }]);
    const trace = (await ref.collection("trace").get()).docs.map((d) => d.data());
    expect(trace).toMatchObject([{ stage: "dictation", kind: "model", name: "muse-voice-transcribe-1.0.transcribe", model: "muse-voice-transcribe-1.0", ok: true, result: "2.0 s transcribed" }]);
    // Nothing the clinician said is stored.
    expect(JSON.stringify([audit, trace, (await ref.get()).data()])).not.toContain("pleural");
  });

  it("refuses another clinician, a signed study, a bad clip and a clip over 60 s", async () => {
    const ref = await study();
    const fake = { transcribe: async () => ({ transcript: said, ms: 1 }) };
    await expect(dictateCore(db, { uid: UID_B1, orgId: "other-clinic" }, { studyId: ref.id, audio }, fake)).rejects.toMatchObject({ code: "permission-denied" });
    const signed = await study("signed");
    await expect(dictateCore(db, UID_A1, { studyId: signed.id, audio }, fake)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(dictateCore(db, UID_A1, { studyId: ref.id, audio: Buffer.from("hello").toString("base64") }, fake)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(dictateCore(db, UID_A1, { studyId: ref.id, audio: wav(16_000 * 62).toString("base64") }, fake)).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("answers dictation_unavailable when the transcriber fails", async () => {
    const ref = await study();
    await expect(
      dictateCore(db, UID_A1, { studyId: ref.id, audio }, { transcribe: async () => { throw new DictationUnavailable("http_503"); } }),
    ).rejects.toMatchObject({ code: "unavailable", details: { error: "dictation_unavailable" } });
    const trace = (await ref.collection("trace").get()).docs.map((d) => d.data());
    expect(trace).toMatchObject([{ ok: false, result: "unavailable (http_503)" }]);
  });
});
