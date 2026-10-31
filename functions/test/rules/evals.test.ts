import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { member, ORG_A, setupEnv, UID_A1 } from "./helpers";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "evalRuns/helio-1"), { system: "helio", published: true });
    await setDoc(doc(db, "evalRuns/helio-1/results/triage-1"), { taskId: "triage-1", score: 1 });
    await setDoc(doc(db, "studies/s1"), { orgId: ORG_A, clinicianUid: UID_A1 });
  });
});

describe("evalRuns (E15 public page)", () => {
  it("anyone, signed in or not, may read runs and their results", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anon, "evalRuns/helio-1")));
    await assertSucceeds(getDocs(collection(anon, "evalRuns/helio-1/results")));
    await assertSucceeds(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "evalRuns/helio-1/results/triage-1")));
  });

  it("no client may write a run or a result, signed in or not", async () => {
    const anon = env.unauthenticatedContext().firestore();
    const signedIn = member(env, UID_A1, ORG_A, "admin").firestore();
    await assertFails(setDoc(doc(anon, "evalRuns/x"), { published: true }));
    await assertFails(setDoc(doc(signedIn, "evalRuns/helio-1"), { published: false }, { merge: true }));
    await assertFails(setDoc(doc(signedIn, "evalRuns/helio-1/results/triage-1"), { score: 0 }));
  });

  it("opening evalRuns does not open anything else to anonymous readers", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "studies/s1")));
    await assertFails(getDoc(doc(anon, "evalRunsExtra/x")));
  });
});
