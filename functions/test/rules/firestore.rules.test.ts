import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, deleteDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { member, ORG_A, ORG_B, setupEnv, studyShell, UID_A1, UID_A2, UID_B1, unbound } from "./helpers";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed with rules disabled: one org, two users, one ready study in org A.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "organizations", ORG_A), { name: "Kubi Medical", domains: ["kubimedical.org"] });
    await setDoc(doc(db, "organizations", ORG_B), { name: "Other", domains: ["other.test"] });
    await setDoc(doc(db, "users", UID_A1), {
      uid: UID_A1, email: "a1@kubimedical.org", displayName: "A. Smith", title: "Dr.",
      orgId: ORG_A, role: "clinician", orgConfirmedAt: null,
    });
    await setDoc(doc(db, "studies", "ready-a1"), {
      ...studyShell(ORG_A, UID_A1),
      status: "ready",
      findings: [{ id: "f1", index: 0, title: "x", description: "", confidence: 90, region: null, color: "#F5B400", status: "pending", reviewedAt: null }],
    });
    await setDoc(doc(db, "studies", "uploading-a1"), studyShell(ORG_A, UID_A1));
  });
});

describe("organizations", () => {
  it("members can read their own organization", async () => {
    await assertSucceeds(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "organizations", ORG_A)));
  });

  it("other organizations and unbound users are denied", async () => {
    await assertFails(getDoc(doc(member(env, UID_B1, ORG_B).firestore(), "organizations", ORG_A)));
    await assertFails(getDoc(doc(unbound(env).firestore(), "organizations", ORG_A)));
  });

  it("the client can never write an organization", async () => {
    const db = member(env, UID_A1, ORG_A, "admin").firestore();
    await assertFails(updateDoc(doc(db, "organizations", ORG_A), { name: "Renamed" }));
  });
});

describe("users", () => {
  it("a user reads only their own document", async () => {
    await assertSucceeds(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "users", UID_A1)));
    await assertFails(getDoc(doc(member(env, UID_A2, ORG_A).firestore(), "users", UID_A1)));
  });

  it("allows confirming the organization and editing the display name", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", UID_A1), { orgConfirmedAt: new Date(), displayName: "A. J. Smith", title: "Prof.", updatedAt: new Date() }),
    );
  });

  it("refuses privilege or binding changes", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertFails(updateDoc(doc(db, "users", UID_A1), { role: "admin" }));
    await assertFails(updateDoc(doc(db, "users", UID_A1), { orgId: ORG_B }));
    await assertFails(updateDoc(doc(db, "users", UID_A1), { email: "someone@else.test" }));
  });

  it("refuses self sign-up and deletion", async () => {
    const db = member(env, UID_A2, ORG_A).firestore();
    await assertFails(setDoc(doc(db, "users", UID_A2), { uid: UID_A2, email: "x@kubimedical.org", role: "clinician" }));
    await assertFails(deleteDoc(doc(member(env, UID_A1, ORG_A).firestore(), "users", UID_A1)));
  });
});

describe("studies: read", () => {
  it("any member of the organization can read a study", async () => {
    await assertSucceeds(getDoc(doc(member(env, UID_A2, ORG_A).firestore(), "studies", "ready-a1")));
  });

  it("members of another organization and unbound users cannot", async () => {
    await assertFails(getDoc(doc(member(env, UID_B1, ORG_B).firestore(), "studies", "ready-a1")));
    await assertFails(getDoc(doc(unbound(env).firestore(), "studies", "ready-a1")));
  });

  it("list queries must be scoped to the caller's organization", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertSucceeds(getDocs(query(collection(db, "studies"), where("orgId", "==", ORG_A))));
    await assertFails(getDocs(query(collection(db, "studies"), where("orgId", "==", ORG_B))));
    await assertFails(getDocs(collection(db, "studies")));
  });
});

describe("studies: create", () => {
  it("no client creates a study; the backend does (startUpload, createDemoStudy)", async () => {
    await assertFails(setDoc(doc(member(env, UID_A1, ORG_A).firestore(), "studies", "new-1"), studyShell(ORG_A, UID_A1)));
    await assertFails(setDoc(doc(unbound(env).firestore(), "studies", "n7"), studyShell(ORG_A, "uid-unbound")));
  });
});

describe("studies: while the backend uploads", () => {
  it("the client cannot move or edit a study that is still uploading", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertFails(updateDoc(doc(db, "studies", "uploading-a1"), { status: "queued", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db, "studies", "uploading-a1"), { status: "failed", updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db, "studies", "uploading-a1"), { status: "ready" }));
    await assertFails(updateDoc(doc(member(env, UID_A2, ORG_A).firestore(), "studies", "uploading-a1"), { status: "queued" }));
  });
});

describe("studies: review of a ready study", () => {
  it("owner updates review fields and keeps status ready", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "studies", "ready-a1"), {
        findings: [{ id: "f1", index: 0, title: "x", description: "", confidence: 90, region: null, color: "#F5B400", status: "accepted", reviewedAt: new Date() }],
        reviewHash: "abc",
        updatedAt: new Date(),
      }),
    );
    await assertSucceeds(updateDoc(doc(db, "studies", "ready-a1"), { deletedAt: new Date(), updatedAt: new Date() }));
    // Shares and the patient summary are backend-only before signing (B16/B17).
    await assertFails(
      updateDoc(doc(db, "studies", "ready-a1"), { shares: [{ id: "s1", channel: "pdf", target: "", sentAt: new Date() }], updatedAt: new Date() }),
    );
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { patientSummary: { title: "x" }, updatedAt: new Date() }));
  });

  it("owner cannot change status, modality, patient or image once ready", async () => {
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { status: "queued" }));
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { modality: "skin" }));
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { patient: { name: "Someone Else" } }));
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { pipeline: { runId: "x" } }));
    // B14: the read is written only by Functions; a client can't open, sign or clear it.
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { radiologistRead: { required: true, status: "signed" }, updatedAt: new Date() }));
  });

  it("colleagues in the same organization may read but not review", async () => {
    const db = member(env, UID_A2, ORG_A).firestore();
    const snap = await getDoc(doc(db, "studies", "ready-a1"));
    expect(snap.exists()).toBe(true);
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { reviewHash: "hijack" }));
  });

  it("nobody hard-deletes from the client", async () => {
    await assertFails(deleteDoc(doc(member(env, UID_A1, ORG_A, "admin").firestore(), "studies", "ready-a1")));
  });
});

describe("judges' console: trace, audit and samples (B19/F11)", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      await setDoc(doc(f, "studies", "demo-1"), { ...studyShell("demo", "uid-demo-1"), status: "ready" });
      await setDoc(doc(f, "studies", "demo-1", "trace", "t1"), { name: "glimmer.chat", ok: true });
      await setDoc(doc(f, "studies", "demo-1", "audit", "a1"), { action: "status_changed" });
      await setDoc(doc(f, "studies", "ready-a1", "trace", "t1"), { name: "glimmer.chat", ok: true });
      await setDoc(doc(f, "samples", "s1"), { title: "Sample 1 · chest X-ray" });
    });
  });

  it("demo accounts read their own cases, with trace and audit, and the samples", async () => {
    const judge = member(env, "uid-demo-1", "demo", "demo").firestore();
    await assertSucceeds(getDoc(doc(judge, "studies", "demo-1")));
    await assertSucceeds(getDoc(doc(judge, "studies", "demo-1", "trace", "t1")));
    await assertSucceeds(getDoc(doc(judge, "studies", "demo-1", "audit", "a1")));
    await assertSucceeds(getDocs(query(collection(judge, "studies"), where("orgId", "==", "demo"), where("clinicianUid", "==", "uid-demo-1"))));
    await assertSucceeds(getDoc(doc(judge, "samples", "s1")));
    await assertFails(setDoc(doc(judge, "studies", "demo-1", "trace", "t2"), { name: "forged" }));
  });

  it("demo accounts can't see another demo account's cases", async () => {
    const other = member(env, "uid-demo-2", "demo", "demo").firestore();
    await assertFails(getDoc(doc(other, "studies", "demo-1")));
    await assertFails(getDoc(doc(other, "studies", "demo-1", "trace", "t1")));
    await assertFails(getDoc(doc(other, "studies", "demo-1", "audit", "a1")));
    await assertFails(getDocs(query(collection(other, "studies"), where("orgId", "==", "demo"))));
  });

  it("demo accounts can't read a real organization's trace; its clinicians can't read their own org's trace, admins can", async () => {
    await assertFails(getDoc(doc(member(env, "uid-demo-2", "demo", "demo").firestore(), "studies", "ready-a1", "trace", "t1")));
    await assertFails(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "studies", "ready-a1", "trace", "t1")));
    await assertSucceeds(getDoc(doc(member(env, UID_A2, ORG_A, "admin").firestore(), "studies", "ready-a1", "trace", "t1")));
    await assertFails(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "samples", "s1")));
  });
});

describe("workspace samples (§4.11)", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const f = ctx.firestore();
      await setDoc(doc(f, "studies", "sample-1"), {
        ...studyShell("demo", "samples"),
        source: "sample",
        status: "ready",
        findings: [{ id: "f1", status: "pending" }],
      });
      await setDoc(doc(f, "studies", "sample-1", "trace", "t1"), { name: "glimmer.chat", ok: true });
      await setDoc(doc(f, "studies", "upload-1"), { ...studyShell("demo", "uid-demo-1"), source: "upload", status: "ready" });
    });
  });

  it("every demo account reads the samples, lists them, and reads their trace", async () => {
    for (const uid of ["uid-demo-1", "uid-demo-2"]) {
      const judge = member(env, uid, "demo", "demo").firestore();
      await assertSucceeds(getDoc(doc(judge, "studies", "sample-1")));
      await assertSucceeds(getDoc(doc(judge, "studies", "sample-1", "trace", "t1")));
      await assertSucceeds(getDocs(query(collection(judge, "studies"), where("orgId", "==", "demo"), where("clinicianUid", "==", "samples"))));
    }
  });

  it("a second account sees the samples but not the first account's uploads", async () => {
    const other = member(env, "uid-demo-2", "demo", "demo").firestore();
    await assertFails(getDoc(doc(other, "studies", "upload-1")));
    await assertSucceeds(getDoc(doc(member(env, "uid-demo-1", "demo", "demo").firestore(), "studies", "upload-1")));
  });

  it("any demo account reviews a sample; nobody soft-deletes it or takes it over", async () => {
    const judge = member(env, "uid-demo-2", "demo", "demo").firestore();
    await assertSucceeds(updateDoc(doc(judge, "studies", "sample-1"), { findings: [{ id: "f1", status: "accepted" }], reviewHash: "h" }));
    await assertFails(updateDoc(doc(judge, "studies", "sample-1"), { deletedAt: new Date() }));
    await assertFails(updateDoc(doc(judge, "studies", "sample-1"), { clinicianUid: "uid-demo-2" }));
  });

  it("other organizations can't see the samples, and nobody can create one from a client", async () => {
    await assertFails(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "studies", "sample-1")));
    await assertFails(setDoc(doc(member(env, "uid-demo-1", "demo", "demo").firestore(), "studies", "forged"), { ...studyShell("demo", "samples"), source: "sample" }));
  });
});

describe("studies/{id}/audit", () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "studies", "ready-a1", "audit", "e1"), {
        actor: "pipeline", action: "status_changed", from: "summarizing", to: "ready",
      });
    });
  });

  it("lets an admin of the study's organization read the audit trail", async () => {
    await assertSucceeds(getDoc(doc(member(env, UID_A2, ORG_A, "admin").firestore(), "studies", "ready-a1", "audit", "e1")));
  });

  it("hides the audit trail from clinicians and other organizations' admins", async () => {
    await assertFails(getDoc(doc(member(env, UID_A1, ORG_A).firestore(), "studies", "ready-a1", "audit", "e1")));
    await assertFails(getDoc(doc(member(env, UID_B1, ORG_B, "admin").firestore(), "studies", "ready-a1", "audit", "e1")));
  });

  it("never lets a client write the audit trail, even an admin", async () => {
    const admin = member(env, UID_A2, ORG_A, "admin").firestore();
    await assertFails(setDoc(doc(admin, "studies", "ready-a1", "audit", "e2"), { action: "forged" }));
    await assertFails(deleteDoc(doc(admin, "studies", "ready-a1", "audit", "e1")));
  });
});

describe("radiologists", () => {
  it("read studies in their organization but not another's", async () => {
    await assertSucceeds(getDoc(doc(member(env, "uid-rad", ORG_A, "radiologist").firestore(), "studies", "ready-a1")));
    await assertFails(getDoc(doc(member(env, "uid-rad-b", ORG_B, "radiologist").firestore(), "studies", "ready-a1")));
  });

  it("cannot review a clinician's study from the client", async () => {
    const db = member(env, "uid-rad", ORG_A, "radiologist").firestore();
    await assertFails(updateDoc(doc(db, "studies", "ready-a1"), { findings: [], updatedAt: new Date() }));
  });
});

describe("studies past the draft: patient summary ready (B16/F8/B17)", () => {
  const generated = { body: "Clear.", steps: ["No more tests."] };
  const summary = (confirmed: boolean, over: Record<string, unknown> = {}) => ({
    title: "A note",
    body: "Clear.",
    nextSteps: [{ text: "No more tests.", mapsTo: 0, confirmed }],
    generatedFromReportHash: "sha256:r",
    generated,
    ...over,
  });

  it("the owner confirms or edits a step, but not the generated copy, the source hash or the shares", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "studies", "ps-ready"), {
        ...studyShell(ORG_A, UID_A1),
        status: "patient_summary_ready",
        patientSummary: summary(false),
      });
    });
    const ref = doc(member(env, UID_A1, ORG_A).firestore(), "studies", "ps-ready");
    await assertSucceeds(updateDoc(ref, { patientSummary: summary(true), updatedAt: new Date() }));
    await assertSucceeds(updateDoc(ref, { patientSummary: summary(false, { body: "Edited." }), updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { patientSummary: summary(true, { generated: { body: "Edited.", steps: [] } }), updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { patientSummary: summary(true, { generatedFromReportHash: "sha256:other" }), updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { shares: [{ id: "s1", channel: "pdf" }], updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { status: "shared", updatedAt: new Date() }));
    await assertFails(updateDoc(ref, { report: { summary: { recommendation: "changed" } }, updatedAt: new Date() }));
    await assertFails(
      updateDoc(doc(member(env, UID_A2, ORG_A).firestore(), "studies", "ps-ready"), { patientSummary: null, updatedAt: new Date() }),
    );
  });
});

describe("studies past the draft: signed and shared", () => {
  it("the owner may only soft-delete; summary, shares and report are backend-only", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "studies", "signed-only"), { ...studyShell(ORG_A, UID_A1), status: "signed" });
      await setDoc(doc(ctx.firestore(), "studies", "shared-only"), { ...studyShell(ORG_A, UID_A1), status: "shared" });
    });
    const db = member(env, UID_A1, ORG_A).firestore();
    for (const id of ["signed-only", "shared-only"]) {
      const ref = doc(db, "studies", id);
      // A summary the client writes itself would skip the B16 checks.
      await assertFails(updateDoc(ref, { patientSummary: { title: "x", body: "y", nextSteps: [] }, updatedAt: new Date() }));
      await assertFails(updateDoc(ref, { shares: [{ channel: "pdf" }], updatedAt: new Date() }));
      await assertFails(updateDoc(ref, { report: { summary: { findings: "rewritten" } }, updatedAt: new Date() }));
      await assertFails(updateDoc(ref, { clinicianSummary: { findings: "rewritten after signing" }, updatedAt: new Date() }));
      await assertFails(updateDoc(ref, { status: "ready", updatedAt: new Date() }));
      await assertSucceeds(updateDoc(ref, { deletedAt: new Date(), updatedAt: new Date() }));
    }
  });
});

describe("studies past the draft", () => {
  it("the owner cannot edit a signed study from the client", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "studies", "signed-a1"), { ...studyShell(ORG_A, UID_A1), status: "signed" });
    });
    const db = member(env, UID_A1, ORG_A).firestore();
    await assertFails(updateDoc(doc(db, "studies", "signed-a1"), { findings: [{ id: "f9", status: "accepted" }], updatedAt: new Date() }));
    await assertFails(updateDoc(doc(db, "studies", "signed-a1"), { status: "ready", updatedAt: new Date() }));
  });
});
