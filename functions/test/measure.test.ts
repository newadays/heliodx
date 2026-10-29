import { describe, expect, it } from "vitest";

import { blunting, evaluateMeasurements, measureChest, type Measurement } from "../src/tools/measure";
import { greyStats, qualityIssues, qualityScore } from "../src/tools/quality";

const W = 100;
const H = 100;
/** Filled rectangle mask, inclusive bounds. */
function rect(x0: number, x1: number, y0: number, y1: number, m: Uint8Array = new Uint8Array(W * H)): Uint8Array {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[y * W + x] = 1;
  return m;
}
const grey = (v = 100) => new Uint8Array(W * H).fill(v);
const ids = { leftMaskId: "left-lung", rightMaskId: "right-lung" };
const get = (ms: Measurement[], id: string) => ms.find((m) => m.id === id)?.value;

describe("measureChest", () => {
  // Patient's right lung on the image left, left lung on the image right.
  const right = () => rect(10, 39, 10, 89);
  const left = () => rect(60, 89, 10, 89);

  it("measures the cardiothoracic ratio as inner gap over outer span", () => {
    const out = measureChest({ left: left(), right: right(), grey: grey(), width: W, height: H, ...ids });
    expect(get(out.measurements, "cardiothoracic_ratio")).toBe(0.25); // 20 / 80
    expect(out.heartBox?.[0]).toBe(0.4);
    expect(out.heartBox?.[2]).toBe(0.6);
  });

  it("ignores thin slivers near the diaphragm when finding the heart gap", () => {
    const r = right();
    const l = left();
    rect(10, 13, 90, 97, r); // lateral slivers below the main fields
    rect(86, 89, 90, 97, l);
    const out = measureChest({ left: l, right: r, grey: grey(), width: W, height: H, ...ids });
    expect(get(out.measurements, "cardiothoracic_ratio")).toBe(0.25);
  });

  it("measures area asymmetry and the left/right brightness ratio", () => {
    const g = grey(100);
    for (let y = 10; y <= 49; y++) for (let x = 60; x <= 89; x++) g[y * W + x] = 150;
    const out = measureChest({ left: rect(60, 89, 10, 49), right: right(), grey: g, width: W, height: H, ...ids });
    expect(get(out.measurements, "lung_area_asymmetry")).toBe(0.5);
    expect(get(out.measurements, "density_ratio")).toBe(1.5);
  });
});

describe("blunting", () => {
  it("is 0 for a lung whose outer corner reaches the bottom, and 1 when the outer corner is empty", () => {
    expect(blunting(rect(10, 39, 10, 89), W, H, "left")).toBe(0);
    const m = rect(10, 39, 10, 89);
    for (let y = 78; y <= 89; y++) for (let x = 10; x <= 18; x++) m[y * W + x] = 0; // outer-bottom corner filled by fluid
    expect(blunting(m, W, H, "left")).toBe(1);
  });

  it("cannot judge an angle cut off by the bottom of the film", () => {
    expect(blunting(rect(10, 39, 10, 99), W, H, "left")).toBeNull();
  });

  it("reads a lung that dips lower laterally than medially as sharp", () => {
    const m = rect(10, 39, 10, 80);
    rect(10, 14, 81, 89, m); // only the outer edge reaches the bottom band
    expect(blunting(m, W, H, "left")).toBe(0);
  });
});

describe("evaluateMeasurements", () => {
  const m = (id: Measurement["id"], value: number): Measurement => ({ id, value, maskIds: [] });

  it("grades asymmetry urgent then critical", () => {
    expect(evaluateMeasurements([m("lung_area_asymmetry", 0.1)], "PA")).toEqual([]);
    expect(evaluateMeasurements([m("lung_area_asymmetry", 0.18)], "PA")[0].level).toBe("urgent");
    expect(evaluateMeasurements([m("lung_area_asymmetry", 0.3)], "PA")[0].level).toBe("critical");
  });

  it("flags the cardiothoracic ratio on PA films only", () => {
    expect(evaluateMeasurements([m("cardiothoracic_ratio", 0.6)], "PA")[0].level).toBe("urgent");
    expect(evaluateMeasurements([m("cardiothoracic_ratio", 0.6)], "AP")).toEqual([]);
  });

  it("flags density in either direction and blunting above its threshold", () => {
    expect(evaluateMeasurements([m("density_ratio", 1.3)], "PA")).toHaveLength(1);
    expect(evaluateMeasurements([m("density_ratio", 0.75)], "PA")).toHaveLength(1);
    expect(evaluateMeasurements([m("density_ratio", 1.05)], "PA")).toEqual([]);
    expect(evaluateMeasurements([m("cp_blunting_left", 0.7)], "PA")[0].level).toBe("flag");
  });
});

describe("quality", () => {
  it("reads a flat image as blurred and washed out", () => {
    const s = greyStats(new Uint8Array(64 * 64).fill(120), 64, 64);
    expect(s.sharpness).toBe(0);
    expect(qualityIssues({ ...s, width: 2048, height: 1661 })).toEqual([
      "Image looks blurred.",
      "Image looks washed out (low contrast).",
    ]);
  });

  it("passes the calibrated sample film's numbers and catches each problem", () => {
    const good = { sharpness: 58.76, mean: 113.1, p1: 4, p99: 205, clipped: 0.0067, width: 2048, height: 1661 };
    expect(qualityIssues(good)).toEqual([]);
    expect(qualityIssues({ ...good, sharpness: 10 })).toEqual(["Image looks blurred."]);
    expect(qualityIssues({ ...good, mean: 28 })).toEqual(["Image looks underexposed."]);
    expect(qualityIssues({ ...good, width: 400, height: 324 })).toEqual(["Image resolution is too low."]);
  });
});

describe("qualityScore", () => {
  const good = { sharpness: 57.27, mean: 113.1, p1: 4, p99: 205, clipped: 0.0067, width: 2048, height: 1661 };
  it("scores the sample film high and degraded copies lower", () => {
    expect(qualityScore(good)).toBeGreaterThanOrEqual(95);
    expect(qualityScore({ ...good, sharpness: 4 })).toBeLessThan(qualityScore(good));
    expect(qualityScore({ ...good, mean: 28, p1: 1, p99: 51 })).toBeLessThan(60);
  });
});

