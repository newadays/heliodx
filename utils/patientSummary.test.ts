import { describe, expect, it } from "vitest";

import type { PatientSummary } from "@/types/study";

import {
  allStepsConfirmed,
  attributionLine,
  nextStepLines,
  normalizePatientSummary,
  unconfirmedCount,
  withEdits,
  withStepConfirmed,
} from "./patientSummary";

const summary: PatientSummary = {
  title: "A note from Dr. A. Smith about your chest X-ray",
  body: "Your X-ray shows a cloudy patch.",
  nextSteps: [
    { text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: false },
    { text: "Repeat chest X-ray in 6 weeks.", mapsTo: 1, confirmed: false, fromSignedText: true },
  ],
  reviewedBy: "Dr. A. Smith",
  attribution: "Reviewed and approved by Dr. A. Smith",
  readingGrade: 5.2,
  generatedFromReportHash: "sha256:abc",
  editedByClinician: false,
};

describe("normalizePatientSummary", () => {
  it("keeps a B16 summary and fills missing step fields", () => {
    expect(normalizePatientSummary(summary)).toEqual(summary);
    const partial = normalizePatientSummary({ ...summary, nextSteps: [{ text: "Rest." } as never] });
    expect(partial?.nextSteps).toEqual([{ text: "Rest.", mapsTo: 0, confirmed: false }]);
  });

  it("turns an old single-string next steps into one unconfirmed step", () => {
    const old = normalizePatientSummary({ ...summary, nextSteps: "Your clinician will talk with you." });
    expect(old?.nextSteps).toEqual([{ text: "Your clinician will talk with you.", mapsTo: 0, confirmed: false }]);
    expect(normalizePatientSummary({ ...summary, nextSteps: "" })?.nextSteps).toEqual([]);
    expect(normalizePatientSummary(null)).toBeNull();
  });
});

describe("confirming steps", () => {
  it("needs every step confirmed before sharing", () => {
    expect(allStepsConfirmed(summary)).toBe(false);
    expect(unconfirmedCount(summary)).toBe(2);
    const one = withStepConfirmed(summary, 0, true);
    expect(unconfirmedCount(one)).toBe(1);
    expect(allStepsConfirmed(withStepConfirmed(one, 1, true))).toBe(true);
    expect(allStepsConfirmed(null)).toBe(false);
    expect(summary.nextSteps[0].confirmed).toBe(false); // not mutated
  });
});

describe("withEdits", () => {
  it("re-opens only the steps whose text changed and marks the summary edited", () => {
    const confirmed = withStepConfirmed(withStepConfirmed(summary, 0, true), 1, true);
    const next = withEdits(confirmed, {
      title: " New title ",
      body: "Body.",
      steps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."],
    });
    expect(next.title).toBe("New title");
    expect(next.editedByClinician).toBe(true);
    expect(next.nextSteps[0]).toEqual({ text: "Your doctor will check how you feel.", mapsTo: 0, confirmed: true });
    expect(next.nextSteps[1]).toEqual({ text: "You will have another X-ray in 6 weeks.", mapsTo: 1, confirmed: false });
  });
});

describe("output helpers", () => {
  it("lists step text and prefers the B16 attribution", () => {
    expect(nextStepLines(summary)).toEqual(["Your doctor will check how you feel.", "Repeat chest X-ray in 6 weeks."]);
    expect(attributionLine(summary)).toBe("Reviewed and approved by Dr. A. Smith");
    expect(attributionLine({ reviewedBy: "Dr. B" })).toBe("Reviewed by Dr. B");
  });
});
