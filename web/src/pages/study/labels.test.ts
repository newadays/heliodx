import { describe, expect, it } from "vitest";

import type { FindingView } from "~/data/model";

import { placeLabels } from "./labels";

type F = Pick<FindingView, "n" | "abnormal" | "decision" | "outlines" | "patternLabel">;
const zone = (side: "left" | "right", zone: "upper" | "middle" | "lower", x: number, y: number, w = 30, h = 25) => ({ side, zone, kind: "zone" as const, x, y, w, h });
const f = (n: number, outlines: F["outlines"], over: Partial<F> = {}): F => ({ n, abnormal: true, decision: "pending", outlines, patternLabel: null, ...over });

describe("placeLabels", () => {
  it("puts the right lung's chip on the image's left, the left lung's on the right", () => {
    const [r, l] = placeLabels([f(1, [zone("right", "upper", 15, 10), zone("left", "upper", 55, 10)], { patternLabel: "TB-suggestive" })]);
    // Just above the zone (it starts at 10%), against the image's left edge.
    expect(r.chip).toEqual({ x: 3, y: 4, align: "left" });
    // From the ellipse's outer-top point (45°) to the chip.
    expect(r.line.x1).toBeCloseTo(30 - 15 * Math.SQRT1_2);
    expect(r.line.y1).toBeCloseTo(22.5 - 12.5 * Math.SQRT1_2);
    expect([r.line.x2, r.line.y2]).toEqual([7, 4]);
    expect(l.chip.align).toBe("right");
    expect(l.line.x1).toBeCloseTo(70 + 15 * Math.SQRT1_2);
    expect(r.text).toBe("TB-suggestive");
    expect(r.aria).toBe("Finding 1, right lung upper zone, TB-suggestive");
  });
  it("labels an untagged abnormal finding by its number", () => {
    const [x] = placeLabels([f(3, [zone("left", "lower", 55, 60)])]);
    expect(x.text).toBe("Attention · 3");
    expect(x.aria).toBe("Finding 3, left lung lower zone, needs attention");
  });
  it("goes below a zone with no room above, and stacks chips on one side so they never overlap", () => {
    const placed = placeLabels([f(1, [zone("right", "upper", 15, 0, 30, 2)]), f(2, [zone("right", "upper", 15, 1, 30, 2)])]);
    expect(placed.map((p) => p.chip.y)).toEqual([8, 14]);
    expect(placed[1].line.y2).toBe(14);
    expect(placed[0].line.y1).toBeGreaterThan(1); // from the ellipse's lower half
  });
  it("skips normal and rejected findings and findings without outlines", () => {
    expect(placeLabels([f(1, [zone("right", "upper", 15, 10)], { abnormal: false })])).toEqual([]);
    expect(placeLabels([f(1, [zone("right", "upper", 15, 10)], { decision: "rejected" })])).toEqual([]);
    expect(placeLabels([f(1, [])])).toEqual([]);
  });
  it("puts a heart-region chip above it", () => {
    const [h] = placeLabels([f(2, [{ side: null, zone: null, kind: "heart", x: 40, y: 50, w: 20, h: 30 }])]);
    expect(h.chip).toEqual({ x: 50, y: 44, align: "top" });
    expect(h.aria).toBe("Finding 2, heart region, needs attention");
  });
});
