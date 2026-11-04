import { describe, expect, it } from "vitest";

import { hasPatternOfConcern, patternLift, patternOf, PATTERNS } from "../src/lib/patterns";
import { readRequirement, READ_REASON_TEXT } from "../src/radiology/gate";
import { jargonIn } from "../src/lib/patientSummary";
import { assertsCondition } from "../src/lib/vocabulary";

describe("patternOf", () => {
  it("reads the model's text in code, legacy ids included; unknown is null", () => {
    expect(patternOf("pattern_of_concern")).toBe("pattern_of_concern");
    expect(patternOf("Pattern of concern")).toBe("pattern_of_concern");
    expect(patternOf("tb_suggestive")).toBe("pattern_of_concern");
    expect(patternOf("none")).toBe("none");
    expect(patternOf("")).toBe("none");
    expect(patternOf("pneumonia_like")).toBeNull();
  });
});

describe("the pattern", () => {
  it("names radiographic features only, never a disease", () => {
    const p = PATTERNS.pattern_of_concern;
    expect(assertsCondition(`${p.label} ${p.cues}`)).toBe(false);
    expect(Object.keys(p).sort()).toEqual(["concern", "cues", "label"]);
  });
  it("counts only on an abnormal observation", () => {
    expect(hasPatternOfConcern([{ abnormal: true, pattern: "pattern_of_concern" }])).toBe(true);
    expect(hasPatternOfConcern([{ abnormal: true, pattern: "tb_suggestive" }])).toBe(true);
    expect(hasPatternOfConcern([{ abnormal: false, pattern: "pattern_of_concern" }])).toBe(false);
    expect(hasPatternOfConcern([{ abnormal: true, pattern: "none" }])).toBe(false);
  });
});

describe("priority lift", () => {
  const tagged = [{ abnormal: true, pattern: "pattern_of_concern" }];
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
  it("requires a read for a kept pattern of concern, not a plain abnormal one", () => {
    expect(readRequirement({ priority: "urgent", findings: [f("accepted", "pattern_of_concern")] })).toEqual({ reason: "pattern_of_concern" });
    expect(readRequirement({ priority: "urgent", findings: [f("edited", "tb_suggestive")] })).toEqual({ reason: "pattern_of_concern" });
    expect(readRequirement({ priority: "urgent", findings: [f("pending", "pattern_of_concern")] })).toBeNull();
    expect(readRequirement({ priority: "urgent", findings: [f("rejected", "pattern_of_concern")] })).toBeNull();
    expect(readRequirement({ priority: "urgent", findings: [f("accepted", "none")] })).toBeNull();
    expect(readRequirement({ priority: "critical", findings: [f("accepted", "pattern_of_concern")] })).toEqual({ reason: "critical" });
    expect(READ_REASON_TEXT.pattern_of_concern).toBe("a pattern of concern");
  });
});

describe("patient-note jargon", () => {
  it("fails radiology words", () => {
    expect(jargonIn("Reticulonodular opacities at the apical zone.")).toEqual(["reticulonodular", "opacities", "apical"]);
  });
});
