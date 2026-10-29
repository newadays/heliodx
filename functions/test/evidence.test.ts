import { describe, expect, it } from "vitest";

import { confidenceBand, evidenceLine, polarityOf } from "../src/lib/evidence";
import { assertsCondition } from "../src/lib/vocabulary";

describe("evidence", () => {
  const m = [
    { id: "cardiothoracic_ratio", value: 0.4509 },
    { id: "lung_area_asymmetry", value: 0.021 },
    { id: "density_ratio", value: 1.0912 },
    { id: "cp_blunting_left", value: 0 },
    { id: "cp_blunting_right", value: 0 },
  ];

  it("writes 'value · limit' lines with two decimals", () => {
    expect(evidenceLine(["cardiothoracic_ratio"], m)).toBe("Cardiothoracic ratio 0.45 · limit 0.55");
    expect(evidenceLine(["lung_area_asymmetry"], m)).toBe("Area difference 2.1% · limit 15%");
    expect(evidenceLine(["density_ratio"], m)).toBe("Left/right mean brightness ratio 1.09 · limit 1.25");
    expect(evidenceLine(["cp_blunting_left", "cp_blunting_right"], m)).toBe("Blunting 0 / 0 · limit 0.6");
    expect(evidenceLine(["cp_blunting_left"], m)).toBe("Left blunting 0 · limit 0.6");
  });

  it("returns null for outline-only findings and unknown ids", () => {
    expect(evidenceLine(["mask-left"], m)).toBeNull();
    expect(evidenceLine(["cardiothoracic_ratio"], [])).toBeNull();
  });

  it("never names a condition", () => {
    const line = evidenceLine(m.map((x) => x.id), m)!;
    expect(assertsCondition(line)).toBe(false);
  });

  it("is attention only when a cited measurement was flagged", () => {
    expect(polarityOf(["density_ratio"], [{ measurementId: "density_ratio" }])).toBe("attention");
    expect(polarityOf(["cardiothoracic_ratio"], [{ measurementId: "density_ratio" }])).toBe("normal");
  });

  it("bands confidence", () => {
    expect([0.9, 0.85, 0.7, 0.6, 0.5].map(confidenceBand)).toEqual(["high", "high", "moderate", "moderate", "low"]);
  });
});
