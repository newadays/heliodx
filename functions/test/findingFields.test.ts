import { describe, expect, it } from "vitest";

import { CASE_ID_ALPHABET, newCaseId } from "../src/lib/caseId";
import { ctrOverlays, findingFields } from "../src/lib/findingFields";

const masks = [
  { label: "right lung", box: [0.1, 0.2, 0.45, 0.8] as [number, number, number, number] },
  { label: "left lung", box: [0.55, 0.2, 0.9, 0.8] as [number, number, number, number] },
];
const measurements = [
  { id: "cardiothoracic_ratio", value: 0.4509 },
  { id: "cp_blunting_left", value: 0 },
  { id: "cp_blunting_right", value: 0 },
];

describe("findingFields", () => {
  it("places one marker per costophrenic angle, image-left for the patient's right", () => {
    const f = findingFields(
      { index: 3, region: { x: 0.1, y: 0.6, w: 0.8, h: 0.2 }, evidence: { measurementIds: ["cp_blunting_left", "cp_blunting_right"], maskIds: [] } },
      { measurements, flags: [], masks },
    );
    expect(f.evidenceLine).toBe("Blunting 0 / 0 · limit 0.6");
    expect(f.polarity).toBe("normal");
    expect(f.regions.map((r) => r.label)).toEqual(["right costophrenic angle", "left costophrenic angle"]);
    expect(f.regions[0].x).toBeLessThan(0.5);
    expect(f.regions[1].x).toBeGreaterThan(0.5);
  });

  it("uses the region centre otherwise, and flags attention from triage", () => {
    const f = findingFields(
      { index: 0, region: { x: 0.4, y: 0.5, w: 0.2, h: 0.2 }, evidence: { measurementIds: ["cardiothoracic_ratio"], maskIds: [] } },
      { measurements, flags: [{ measurementId: "cardiothoracic_ratio" }], masks },
    );
    expect(f.regions).toEqual([{ x: 0.5, y: 0.6 }]);
    expect(f.polarity).toBe("attention");
  });

  it("draws the CTR widths tied to the finding that cites the ratio", () => {
    const lines = { heart: { y: 0.62, x0: 0.4, x1: 0.58 }, thorax: { y: 0.67, x0: 0.14, x1: 0.86 } };
    const out = ctrOverlays(lines, 0.4509, [{ index: 2, region: null, evidence: { measurementIds: ["cardiothoracic_ratio"], maskIds: [] } }]);
    expect(out.map((o) => o.label)).toEqual(["heart 0.45", "thorax · CTR 0.45"]);
    expect(out[0]).toMatchObject({ findingIndex: 2, from: { x: 0.4, y: 0.62 }, to: { x: 0.58, y: 0.62 } });
    expect(ctrOverlays(null, 0.45, [])).toEqual([]);
  });
});

describe("caseId", () => {
  it("is prefixed by source and has no look-alikes", () => {
    const upload = newCaseId("upload");
    const sample = newCaseId("sample");
    expect(upload).toMatch(/^U-[A-Z2-9]{4}$/);
    expect(sample).toMatch(/^S-[A-Z2-9]{5}$/);
    expect([...upload.slice(2), ...sample.slice(2)].every((c) => CASE_ID_ALPHABET.includes(c))).toBe(true);
    expect(CASE_ID_ALPHABET).not.toMatch(/[01OIL]/);
  });
});
