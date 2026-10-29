/** B23 against the Firestore emulator: background report drafts follow the decisions. */
import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { draftReport, needsDraft } from "../../src/lib/reportDraft";
import { reviewHash } from "../../src/lib/reviewHash";

let app: App;
let db: Firestore;

beforeAll(() => {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  app = initializeApp({ projectId: "heliodx-rules-test-draft" }, `draft-${randomUUID()}`);
  db = getFirestore(app);
});
afterAll(async () => {
  await deleteApp(app);
});

const noSleep = async () => undefined;

async function study(findings: { id: string; status: string }[], extra: Record<string, unknown> = {}) {
  const ref = db.collection("studies").doc();
  await ref.set({
    status: "ready",
    findings: findings.map((f, i) => ({ ...f, index: i, title: `Finding ${i + 1}`, description: "x" })),
    reviewHash: reviewHash(findings as never),
    clinicianSummary: { findings: "old", impression: ["old"], recommendation: "old", highlights: [], generatedFromReviewHash: "r1-old", editedByClinician: false },
    ...extra,
  });
  return ref;
}

function fakeDraft(text: string) {
  return async (s: { findings?: unknown[] }) => {
    const hash = reviewHash((s.findings ?? []) as never);
    return { hash, clinicianSummary: { findings: text, impression: [text], recommendation: "r", highlights: [], generatedFromReviewHash: hash, editedByClinician: false } };
  };
}

describe("draftReport", () => {
  it("waits for a cold GPU, saying so on the study, then drafts", async () => {
    const ref = await study([{ id: "a", status: "accepted" }]);
    const states = ["down", "loading", "ok"] as const;
    let calls = 0;
    let warmingSeen = false;
    const health = async () => {
      if (calls > 0) warmingSeen ||= (await ref.get()).get("reportDraft.warming") === true;
      return { glimmer: states[Math.min(calls++, states.length - 1)] };
    };
    let t = 0;
    const out = await draftReport(db, ref, { sleep: noSleep, now: () => (t += 1000), health, draft: fakeDraft("warm") as never });
    expect(out).toBe("drafted");
    expect(warmingSeen).toBe(true);
    const snap = await ref.get();
    expect(snap.get("clinicianSummary.findings")).toBe("warm");
    expect(snap.get("reportDraft.warming")).toBe(false);
  });

  it("gives up after the wait budget and releases the claim for a retry", async () => {
    const ref = await study([{ id: "a", status: "accepted" }]);
    let t = 0;
    const out = await draftReport(db, ref, { sleep: noSleep, now: () => (t += 60_000), health: async () => ({ glimmer: "down" as const }), draft: fakeDraft("never") as never });
    expect(out).toBe("gpu_unavailable");
    const snap = await ref.get();
    expect(snap.get("reportDraft.forHash")).toBeNull();
    expect(snap.get("reportDraft.reason")).toBe("gpu_starting");
    expect(snap.get("clinicianSummary.findings")).toBe("old");
  });

  it("an explicit request drafts a stale report even with findings undecided", () => {
    const base = { status: "ready", findings: [{ id: "a", status: "pending" }], reviewHash: "r1-x", clinicianSummary: { generatedFromReviewHash: "r1-old", editedByClinician: false } };
    expect(needsDraft(base as never, { ...base, reportDraft: { requestedAt: new Date(1) } } as never)).toBe(true);
    expect(needsDraft(base as never, base as never)).toBe(false);
    const current = { ...base, clinicianSummary: { generatedFromReviewHash: "r1-x", editedByClinician: false } };
    expect(needsDraft(current as never, { ...current, reportDraft: { requestedAt: new Date(2) } } as never)).toBe(false);
  });

  it("drafts once for the current decisions and stamps their hash", async () => {
    const ref = await study([{ id: "f1", status: "accepted" }]);
    expect(await draftReport(db, ref, { sleep: noSleep, draft: fakeDraft("new") as never })).toBe("drafted");
    const s = (await ref.get()).data()!;
    expect(s.clinicianSummary.findings).toBe("new");
    expect(s.clinicianSummary.generatedFromReviewHash).toBe(s.reviewHash);
    expect(await draftReport(db, ref, { sleep: noSleep, draft: fakeDraft("again") as never })).toBe("skipped");
  });

  it("drops a draft overtaken by newer decisions", async () => {
    const ref = await study([{ id: "f1", status: "accepted" }]);
    const slow = async (s: { findings?: unknown[] }) => {
      const findings = [{ id: "f1", status: "rejected" }];
      await ref.update({ findings: findings.map((f, i) => ({ ...f, index: i, title: "Finding 1", description: "x" })), reviewHash: reviewHash(findings as never) });
      return fakeDraft("stale")(s);
    };
    expect(await draftReport(db, ref, { sleep: noSleep, draft: slow as never })).toBe("superseded");
    expect((await ref.get()).data()!.clinicianSummary.findings).toBe("old");
  });

  it("never overwrites a report the clinician edited, or drafts outside review", async () => {
    const edited = await study([{ id: "f1", status: "accepted" }]);
    await edited.update({ "clinicianSummary.editedByClinician": true });
    expect(await draftReport(db, edited, { sleep: noSleep, draft: fakeDraft("x") as never })).toBe("skipped");
    const signed = await study([{ id: "f1", status: "accepted" }], { status: "signed" });
    expect(await draftReport(db, signed, { sleep: noSleep, draft: fakeDraft("x") as never })).toBe("skipped");
  });

  it("waits until every finding has a decision", async () => {
    const ref = await study([{ id: "f1", status: "accepted" }, { id: "f2", status: "pending" }]);
    expect(await draftReport(db, ref, { sleep: noSleep, draft: fakeDraft("x") as never })).toBe("skipped");
  });

  it("only triggers when the decisions changed", () => {
    const base = { status: "ready", reviewHash: "a", clinicianSummary: { generatedFromReviewHash: "z", editedByClinician: false } };
    expect(needsDraft({ ...base } as never, { ...base, reviewHash: "b" } as never)).toBe(true);
    expect(needsDraft({ ...base } as never, { ...base } as never)).toBe(false);
    expect(needsDraft({ ...base } as never, { ...base, reviewHash: "b", clinicianSummary: { generatedFromReviewHash: "b" } } as never)).toBe(false);
  });
});

describe("patientNoteOnSign (B24)", () => {
  it("fires once, on the move to signed, when no note exists", async () => {
    const { justSigned } = await import("../../src/triggers/patientNoteOnSign");
    expect(justSigned({ status: "ready" }, { status: "signed", patientSummary: null })).toBe(true);
    expect(justSigned({ status: "signed" }, { status: "signed", patientSummary: null })).toBe(false);
    expect(justSigned({ status: "ready" }, { status: "signed", patientSummary: { body: "x" } })).toBe(false);
    expect(justSigned({ status: "ready" }, { status: "signed", patientSummary: null, demo: { autopilot: "running" } })).toBe(false);
  });
});
