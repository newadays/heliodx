import { describe, expect, it } from "vitest";

import {
  assemble,
  attributionFor,
  bodyConditionViolations,
  checkRewrite,
  conditionViolations,
  fleschKincaidGrade,
  newInstructionTerms,
  recommendationSentences,
  retryFeedback,
  splitSentences,
  studyWords,
  titleFor,
  type SignedText,
} from "../src/lib/patientSummary";

const signed: SignedText = {
  studyType: "Chest X-ray (PA)",
  findings: "Patchy opacity in the right lower zone.",
  impression: ["Right lower zone opacity, possibly pneumonia."],
  recommendation: "Clinical correlation. Repeat chest X-ray in 6 weeks.",
};
const sentences = recommendationSentences(signed.recommendation);

describe("sentences", () => {
  it("splits on end punctuation followed by a capital or digit", () => {
    expect(splitSentences("See Dr. Smith. Repeat in 6 weeks. 2 views needed")).toEqual([
      "See Dr. Smith.",
      "Repeat in 6 weeks.",
      "2 views needed",
    ]);
    expect(splitSentences("No punctuation here")).toEqual(["No punctuation here"]);
    expect(splitSentences("  ")).toEqual([]);
  });

  it("keeps decimals together and caps the step count", () => {
    expect(splitSentences("CTR is 0.45. Normal.")).toEqual(["CTR is 0.45.", "Normal."]);
    const long = Array.from({ length: 10 }, (_, i) => `Step ${i + 1}.`).join(" ");
    const capped = recommendationSentences(long);
    expect(capped).toHaveLength(8);
    expect(capped[7]).toBe("Step 8. Step 9. Step 10.");
  });
});

describe("reading level", () => {
  it("scores plain text low and dense text high", () => {
    expect(fleschKincaidGrade("Your lungs look clear. You do not need to do anything.")).toBeLessThan(5);
    expect(
      fleschKincaidGrade("Heterogeneous parenchymal consolidation demonstrates radiographic characteristics consistent with infective aetiology."),
    ).toBeGreaterThan(12);
    expect(fleschKincaidGrade("")).toBe(0);
  });
});

describe("new instruction terms", () => {
  it("allows what the signed sentence says, in other words or digits", () => {
    expect(newInstructionTerms("Repeat chest X-ray in 6 weeks.", "You will have another X-ray in six weeks.")).toEqual([]);
    expect(newInstructionTerms("Repeat chest X-ray in six weeks.", "Another X-ray in 6 weeks.")).toEqual([]);
  });

  it("flags added numbers, timeframes, doses and medicines", () => {
    expect(newInstructionTerms("Clinical correlation.", "Take antibiotics for 7 days.")).toEqual(["7", "antibiotic", "day"]);
    expect(newInstructionTerms("Repeat X-ray in 6 weeks.", "Repeat the X-ray in 2 weeks.")).toEqual(["2"]);
    expect(newInstructionTerms("Start inhaler.", "Use your inhaler, 2 puffs daily.")).toEqual(["2", "puff", "daily"]);
  });

  it("flags added tests and urgency, but not a test the signed sentence names", () => {
    expect(newInstructionTerms("Clinical correlation.", "Your doctor may order a CT scan or blood tests.")).toEqual(["ct", "scan", "test"]);
    expect(newInstructionTerms("Clinical correlation.", "Go to the emergency room immediately.")).toEqual(["emergency", "immediately"]);
    expect(newInstructionTerms("Clinical correlation.", "See your doctor as soon as possible.")).toEqual(["asap"]);
    expect(newInstructionTerms("Clinical correlation.", "You may need a biopsy.")).toEqual(["biopsy"]);
    expect(newInstructionTerms("Repeat chest X-ray in 6 weeks.", "You will have another X-ray in six weeks.")).toEqual([]);
    expect(newInstructionTerms("Consider CT chest.", "Your doctor may arrange a CT scan of your chest.")).toEqual(["scan"]);
  });
});

describe("conditions in the body", () => {
  it("allows a condition the impression names, refuses one it does not, ignores negations", () => {
    expect(bodyConditionViolations("The X-ray may show pneumonia.", signed.impression)).toEqual([]);
    expect(bodyConditionViolations("This could be cancer.", signed.impression)).toEqual(["cancer"]);
    expect(bodyConditionViolations("There is no sign of cancer.", signed.impression)).toEqual([]);
  });

  it("a negated impression does not allow the body to assert the condition", () => {
    expect(bodyConditionViolations("You have a pneumothorax.", ["No pneumothorax."])).toEqual(["pneumothorax"]);
    expect(bodyConditionViolations("There is fluid, an effusion, on the right.", ["No pneumothorax.", "Right pleural effusion."])).toEqual([]);
  });

  it("checks next steps too, allowing what the step's own signed sentence names", () => {
    expect(conditionViolations("Come back if the pneumonia gets worse.", ["Cardiomegaly."], "Clinical correlation.")).toEqual(["pneumonia"]);
    expect(conditionViolations("We will check for pneumonia again.", ["Cardiomegaly."], "Follow-up imaging to assess pneumonia.")).toEqual([]);
    const check = checkRewrite({ body: "Your clinician looked at your X-ray.", nextSteps: ["Your doctor will check you, as the cancer may grow.", "Another X-ray in 6 weeks."] }, sentences, signed.impression);
    expect(check.steps[0].added).toEqual(["cancer"]);
    expect(check.ok).toBe(false);
  });
});

describe("checkRewrite and retry feedback", () => {
  it("passes a faithful plain rewrite", () => {
    const c = checkRewrite(
      { body: "Your X-ray shows a cloudy area in your right lung. It may be pneumonia.", nextSteps: ["Your doctor will look at how you feel.", "You will have another X-ray in 6 weeks."] },
      sentences,
      signed.impression,
    );
    expect(c.ok).toBe(true);
  });

  it("fails on added terms, a missing step, a new condition and dense wording; feedback names each", () => {
    const c = checkRewrite({ body: "This could be cancer.", nextSteps: ["Take antibiotics for 7 days."] }, sentences, signed.impression);
    expect(c.ok).toBe(false);
    expect(c.steps[0].added).toEqual(["7", "antibiotic", "day"]);
    expect(c.steps[1]).toEqual({ text: null, added: ["(missing)"] });
    const fb = retryFeedback(c);
    expect(fb).toContain("Step 1 added");
    expect(fb).toContain("cancer");
  });
});

describe("assemble", () => {
  const base = { signed, sentences, signer: "Dr. A. Smith", simulated: false, reportHash: "sha256:abc" };

  it("maps each step to its signed sentence and computes title, attribution and grade", () => {
    const { summary, flagged } = assemble({
      ...base,
      candidates: [{ body: "Your X-ray shows a cloudy area. It may be pneumonia.", nextSteps: ["Your doctor will check how you feel.", "You will have another X-ray in 6 weeks."] }],
    });
    expect(flagged).toBe(0);
    expect(summary.title).toBe("A note from Dr. A. Smith about your chest X-ray");
    expect(summary.attribution).toBe("Reviewed and approved by Dr. A. Smith");
    expect(summary.nextSteps.map((s) => s.mapsTo)).toEqual([0, 1]);
    expect(summary.nextSteps.every((s) => !s.confirmed && !s.fromSignedText)).toBe(true);
    expect(summary.generatedFromReportHash).toBe("sha256:abc");
    expect(summary.readingGrade).toBeGreaterThan(0);
  });

  it("prefers the clean retry, keeps a clean first-draft step, falls back to signed text otherwise", () => {
    const { summary, flagged } = assemble({
      ...base,
      candidates: [
        { body: "This could be cancer.", nextSteps: ["Your doctor will check how you feel.", "Take antibiotics for 7 days."] },
        { body: "Your X-ray shows a cloudy area.", nextSteps: ["Take pills daily.", "Another X-ray in 2 weeks."] },
      ],
    });
    expect(summary.body).toBe("Your X-ray shows a cloudy area.");
    expect(summary.nextSteps[0]).toMatchObject({ text: "Your doctor will check how you feel.", mapsTo: 0 });
    expect(summary.nextSteps[1]).toMatchObject({ text: "Repeat chest X-ray in 6 weeks.", mapsTo: 1, fromSignedText: true });
    expect(flagged).toBe(1);
  });

  it("drops body sentences naming an unsigned condition when no candidate is clean", () => {
    const { summary } = assemble({
      ...base,
      candidates: [{ body: "Your X-ray shows a cloudy area. This could be cancer.", nextSteps: [] }],
    });
    expect(summary.body).toBe("Your X-ray shows a cloudy area.");
  });

  it("marks simulated signers and handles a missing name and study type", () => {
    expect(attributionFor("Dr. B. Lee", true)).toBe("Reviewed and approved by Dr. B. Lee (simulated)");
    expect(titleFor("", "")).toBe("A note from your clinician about your results");
    expect(studyWords("CT chest")).toBe("CT chest");
  });
});
