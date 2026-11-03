import { describe, expect, it } from "vitest";

import { diagnosisHits, diagnosisTerms, namesDiagnosis, reaskFeedback, stripDiagnosis } from "../src/lib/noDiagnosis";

describe("no-diagnosis guard", () => {
  it("catches disease names and diagnostic phrasing", () => {
    expect(diagnosisTerms("Appearance consistent with tuberculosis.")).toEqual(["tuberculosis", "consistent with"]);
    expect(namesDiagnosis("High probability of malignancy.")).toBe(true);
    expect(namesDiagnosis("Likely infective change at the left base.")).toBe(true);
    expect(namesDiagnosis("Findings suggestive of an infection.")).toBe(true);
    expect(namesDiagnosis("A diagnosis of pneumonia.")).toBe(true);
  });

  it("allows observations, negations and the disclaimer", () => {
    expect(namesDiagnosis("Patchy opacity in the right upper zone with a cavity.")).toBe(false);
    expect(namesDiagnosis("No pneumothorax.")).toBe(false);
    expect(namesDiagnosis("AI-drafted for clinician review. Not a diagnosis.")).toBe(false);
    expect(namesDiagnosis("Consolidation in the left lower zone.")).toBe(false);
  });

  it("allows a term the clinician wrote, and strips only the offending sentences", () => {
    expect(namesDiagnosis("Right apical tuberculosis.", ["tuberculosis"])).toBe(false);
    expect(stripDiagnosis("Lungs are clear. Appearance of pneumonia on the right. No pneumothorax.")).toBe("Lungs are clear. No pneumothorax.");
  });

  it("labels each hit for the re-ask and the trace", () => {
    const hits = diagnosisHits([
      { where: "title 1", text: "Cardiomegaly" },
      { where: "title 2", text: "Heart size within limits" },
    ]);
    expect(hits).toEqual(["title 1: cardiomegaly"]);
    expect(reaskFeedback(hits)).toContain("- title 1: cardiomegaly");
  });
});
