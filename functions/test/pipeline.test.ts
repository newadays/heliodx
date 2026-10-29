import { describe, expect, it } from "vitest";

import { mockDraft } from "../src/models/fixtures";
import { FINDING_COLORS } from "../src/lib/colors";
import { shouldStart } from "../src/pipeline/run";

describe("shouldStart", () => {
  const study = { status: "queued" as const, modality: "xray" as const, pipeline: { runId: null } };

  it("starts for a fresh queued or uploading study", () => {
    expect(shouldStart(study, "evt-1").start).toBe(true);
    expect(shouldStart({ ...study, status: "uploading" }, "evt-1").start).toBe(true);
  });

  it("ignores a redelivered event and a study that already moved on", () => {
    expect(shouldStart({ ...study, pipeline: { runId: "evt-1" } }, "evt-1")).toEqual({
      start: false,
      reason: "duplicate_event",
    });
    expect(shouldStart({ ...study, status: "detecting" }, "evt-2").reason).toBe("status_detecting");
    expect(shouldStart({ ...study, status: "ready" }, "evt-2").start).toBe(false);
    expect(shouldStart(null, "evt-2").reason).toBe("study_missing");
  });
});

describe("mockDraft", () => {
  for (const modality of ["xray", "ct_mri", "ultrasound", "lab", "skin"] as const) {
    it(`produces a complete draft for ${modality}`, () => {
      const d = mockDraft(modality, "Dr. A. Smith");
      expect(d.quality.ok).toBe(true);
      expect(d.studyType).not.toBe("");
      expect(d.findings.length).toBeGreaterThan(0);
      expect(d.findings.length).toBeLessThanOrEqual(6);
      d.findings.forEach((f, i) => {
        expect(f.index).toBe(i);
        expect(f.color).toBe(FINDING_COLORS[i]);
        expect(f.status).toBe("pending");
        expect(f.confidence).toBeGreaterThanOrEqual(0);
        expect(f.confidence).toBeLessThanOrEqual(100);
        if (f.region) {
          for (const v of [f.region.x, f.region.y, f.region.w, f.region.h]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      });
      expect("patientSummary" in d.summaries).toBe(false);
      expect(d.summaries.clinicianSummary.impression.length).toBeGreaterThan(0);
    });
  }

  it("resolves highlight offsets that point at the finding titles", () => {
    const d = mockDraft("xray", "Dr. X");
    const text = d.summaries.clinicianSummary.findings;
    expect(d.summaries.clinicianSummary.highlights).toHaveLength(d.findings.length);
    for (const h of d.summaries.clinicianSummary.highlights) {
      const f = d.findings.find((x) => x.id === h.findingId)!;
      expect(text.slice(h.start, h.end)).toBe(f.title);
    }
  });
});
