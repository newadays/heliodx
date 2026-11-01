import { describe, expect, it } from "vitest";

import { hasTbPattern, keepConsiderations, patternLift, patternOf, PATTERNS } from "../src/lib/patterns";
import { readRequirement, READ_REASON_TEXT } from "../src/radiology/gate";
import { checkRewrite, jargonIn } from "../src/lib/patientSummary";

describe("patternOf", () => {
  it("reads the model's text in code; unknown is null", () => {
    expect(patternOf("tb_suggestive")).toBe("tb_suggestive");
    expect(patternOf("TB-suggestive")).toBe("tb_suggestive");
    expect(patternOf("none")).toBe("none");
    expect(patternOf("")).toBe("none");
    expect(patternOf("pneumonia_like")).toBeNull();
  });
});

describe("considerations", () => {
  it("are kept only with a tagged finding, and only when they name TB alone", () => {
    expect(keepConsiderations([PATTERNS.tb_suggestive.clinician], true)).toEqual([PATTERNS.tb_suggestive.clinician]);
    expect(keepConsiderations([PATTERNS.tb_suggestive.clinician], false)).toEqual([]);
    expect(keepConsiderations(["Consider pneumonia or TB."], true)).toEqual([]);
    expect(keepConsiderations(["Correlate with sputum testing.", "", "x", "y"], true)).toEqual(["Correlate with sputum testing.", "x"]);
  });
  it("count a pattern only on an abnormal observation", () => {
    expect(hasTbPattern([{ abnormal: true, pattern: "tb_suggestive" }])).toBe(true);
    expect(hasTbPattern([{ abnormal: false, pattern: "tb_suggestive" }])).toBe(false);
    expect(hasTbPattern([{ abnormal: true, pattern: "none" }])).toBe(false);
  });
});

describe("priority lift", () => {
  const tagged = [{ abnormal: true, pattern: "tb_suggestive" }];
  it("raises routine to urgent once, never lowers", () => {
    expect(patternLift(tagged, "routine")).toBe("urgent");
    expect(patternLift(tagged, undefined)).toBe("urgent");
    expect(patternLift(tagged, "urgent")).toBeNull();
    expect(patternLift(tagged, "critical")).toBeNull();
    expect(patternLift([{ abnormal: true, pattern: "none" }], "routine")).toBeNull();
  });
});

describe("read gate", () => {
  const f = (status: string, pattern: string, abnormal = true) => ({ status, pattern, abnormal, strength: "strong" });
  it("requires a read for a kept TB-suggestive finding, not a plain abnormal one", () => {
    expect(readRequirement({ priority: "urgent", findings: [f("accepted", "tb_suggestive")] })).toEqual({ reason: "pattern_of_concern" });
    expect(readRequirement({ priority: "urgent", findings: [f("edited", "tb_suggestive")] })).toEqual({ reason: "pattern_of_concern" });
    expect(readRequirement({ priority: "urgent", findings: [f("pending", "tb_suggestive")] })).toBeNull();
    expect(readRequirement({ priority: "urgent", findings: [f("rejected", "tb_suggestive")] })).toBeNull();
    expect(readRequirement({ priority: "urgent", findings: [f("accepted", "none")] })).toBeNull();
    expect(readRequirement({ priority: "critical", findings: [f("accepted", "tb_suggestive")] })).toEqual({ reason: "critical" });
    expect(READ_REASON_TEXT.pattern_of_concern).toBe("a TB-suggestive pattern");
  });
});

describe("patient-note jargon", () => {
  it("fails radiology words and passes the plain TB wording", () => {
    expect(jargonIn("Reticulonodular opacities at the apical zone.")).toEqual(["reticulonodular", "opacities", "apical"]);
    const impression = ["Pattern suggestive of pulmonary tuberculosis."];
    const bad = checkRewrite({ body: "Your X-ray shows reticulonodular opacities.", nextSteps: [] }, [], impression);
    expect(bad.ok).toBe(false);
    expect(bad.jargon).toEqual(["reticulonodular", "opacities"]);
    const good = checkRewrite({ body: `Your X-ray shows ${PATTERNS.tb_suggestive.plain}`, nextSteps: [] }, [], impression);
    expect(good.jargon).toEqual([]);
    expect(good.bodyViolations).toEqual([]);
  });
});

describe("signed report", () => {
  it("never carries a consideration unless the clinician added it to the impression", async () => {
    const { freezeReport } = await import("../src/lib/report");
    const tb = PATTERNS.tb_suggestive.clinician;
    const base = { studyType: "Chest X-ray", modality: "xray", findings: [] };
    const summary = { findings: "Patchy opacity.", impression: ["Right upper zone patchy opacity."], recommendation: "Clinical correlation.", considerations: [tb] };
    const plain = JSON.stringify(freezeReport("s1", { ...base, clinicianSummary: summary }, "u", new Date(0)));
    expect(plain).not.toContain("tuberculosis");
    const adopted = freezeReport("s1", { ...base, clinicianSummary: { ...summary, impression: [...summary.impression, tb] } }, "u", new Date(0));
    expect(adopted.summary.impression).toContain(tb);
  });
});
