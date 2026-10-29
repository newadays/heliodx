import { describe, expect, it } from "vitest";
import { reportText } from "./reportText";

describe("reportText", () => {
  it("lays out the sections with a numbered impression", () => {
    const out = reportText({
      studyType: "Chest X-ray (PA)",
      date: "26 Oct 2026",
      findings: "Patchy opacity. No effusion.",
      impression: ["Right lower lobe consolidation.", "Borderline cardiomegaly."],
      recommendation: "Clinical correlation.",
      reviewedBy: "Dr. A. Smith",
      aiDrafted: true,
    });
    expect(out).toBe(
      [
        "CHEST X-RAY (PA)",
        "26 Oct 2026",
        "",
        "FINDINGS",
        "Patchy opacity. No effusion.",
        "",
        "IMPRESSION",
        "1. Right lower lobe consolidation.",
        "2. Borderline cardiomegaly.",
        "",
        "RECOMMENDATION",
        "Clinical correlation.",
        "",
        "Reviewed by Dr. A. Smith",
        "Drafted with AI assistance and reviewed by the clinician.",
      ].join("\n"),
    );
  });

  it("writes a single impression without a number and fills empty sections", () => {
    const out = reportText({ studyType: "", findings: " x ", impression: [" only "], recommendation: "", reviewedBy: "Dr. B" });
    expect(out).toContain("STUDY\n\nFINDINGS\nx\n\nIMPRESSION\nonly\n\nRECOMMENDATION\nNone.\n\nReviewed by Dr. B");
    expect(out).not.toContain("AI assistance");
  });

  it("never includes a patient field", () => {
    const out = reportText({ studyType: "Skin photo", findings: "f", impression: [], recommendation: "r", reviewedBy: "Dr. C" });
    expect(out.toLowerCase()).not.toMatch(/patient:/);
    expect(out).toContain("IMPRESSION\nNone.");
  });

  it("names the signer, date and report hash once signed", () => {
    const out = reportText({
      studyType: "Chest X-ray (PA)",
      findings: "Heart size normal.",
      impression: ["No acute abnormality."],
      recommendation: "Routine follow-up.",
      reviewedBy: "Dr. A. Smith",
      aiDrafted: true,
      signature: { by: "Dr. A. Smith", date: "28 Oct 2026", hash: "sha256:abc123" },
    });
    expect(out).toContain("Signed by Dr. A. Smith, 28 Oct 2026");
    expect(out).toContain("Report hash sha256:abc123");
    expect(out).not.toContain("Reviewed by");
  });
});
