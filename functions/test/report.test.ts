import { describe, expect, it } from "vitest";

import { canonicalJson, freezeReport, reportHash, signNeeds, type SignableStudy } from "../src/lib/report";
import { reviewHash } from "../src/lib/reviewHash";

const findings = [
  { id: "f1", status: "accepted" as const, title: "Heart size normal", description: "CTR 0.45." },
  { id: "f2", status: "edited" as const, title: "Lungs clear", description: "AI wording.", editedText: "Clinician wording." },
  { id: "f3", status: "rejected" as const, title: "Something", description: "Rejected." },
];
const ready = (over: Partial<SignableStudy> = {}): SignableStudy => ({
  studyType: "Chest X-ray (PA)",
  modality: "xray",
  findings,
  clinicianSummary: {
    findings: "Heart size normal. Lungs clear.",
    impression: ["No acute abnormality."],
    recommendation: "Routine follow-up.",
    generatedFromReviewHash: reviewHash(findings),
    editedByClinician: true,
  },
  ...over,
});

describe("signNeeds", () => {
  it("allows a fully reviewed study whose summary the clinician wrote", () => {
    expect(signNeeds(ready())).toEqual([]);
  });

  it("requires every finding decided", () => {
    expect(signNeeds(ready({ findings: [...findings, { id: "f4", status: "pending", title: "x", description: "y" }] }))).toContain(
      "decide_every_finding",
    );
  });

  it("requires an impression and a recommendation", () => {
    const s = ready();
    expect(signNeeds({ ...s, clinicianSummary: { ...s.clinicianSummary, impression: ["  "], recommendation: "" } })).toEqual([
      "write_impression",
      "write_recommendation",
    ]);
  });

  it("refuses an untouched AI draft unless the clinician confirms it", () => {
    const s = ready();
    const untouched = { ...s, clinicianSummary: { ...s.clinicianSummary, editedByClinician: false } };
    expect(signNeeds(untouched)).toEqual(["confirm_impression"]);
    expect(signNeeds(untouched, { confirmImpression: true })).toEqual([]);
  });

  it("refuses a summary drafted from different review decisions unless the clinician edited it", () => {
    const s = ready();
    const stale = { ...s, clinicianSummary: { ...s.clinicianSummary, editedByClinician: false, generatedFromReviewHash: "r1-old" } };
    expect(signNeeds(stale, { confirmImpression: true })).toEqual(["refresh_summary"]);
  });

  it("waits for an open radiologist read", () => {
    expect(signNeeds(ready({ radiologistRead: { required: true, status: "assigned" } }))).toEqual(["close_radiologist_read"]);
    expect(signNeeds(ready({ radiologistRead: { required: true, status: "signed" } }))).toEqual([]);
  });
});

describe("report hash", () => {
  const at = new Date("2026-10-27T20:00:00Z");
  it("freezes the clinician's wording for edited findings", () => {
    const r = freezeReport("s1", ready(), "uid-1", at);
    expect(r.findings.find((f) => f.id === "f2")?.text).toBe("Clinician wording.");
    expect(r.signedAt).toBe("2026-10-27T20:00:00.000Z");
  });

  it("does not depend on key order, and changes when any text changes", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
    const h1 = reportHash(freezeReport("s1", ready(), "uid-1", at));
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reportHash(freezeReport("s1", ready(), "uid-1", at))).toBe(h1);
    const changed = ready();
    changed.clinicianSummary!.recommendation = "Repeat film in 6 weeks.";
    expect(reportHash(freezeReport("s1", changed, "uid-1", at))).not.toBe(h1);
  });
});
