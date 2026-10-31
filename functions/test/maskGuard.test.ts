import { describe, expect, it } from "vitest";

import { outlineRatio, partialLungs, partialNote } from "../src/lib/maskGuard";

const pair = (left: number[], right: number[]) => [
  { label: "left lung", box: left },
  { label: "right lung", box: right },
];

describe("partialLungs", () => {
  it("passes a real pair (eval films: ratio 0.80 or more)", () => {
    expect(partialLungs(pair([0.49, 0.13, 0.84, 0.75], [0.11, 0.12, 0.42, 0.76]))).toEqual([]);
    expect(partialLungs(pair([0.55, 0.1, 0.9, 0.62], [0.1, 0.1, 0.45, 0.74]))).toEqual([]); // 0.81
  });
  it("flags a sliver at the apex and U-SGF4's half lung", () => {
    // NIH film 3: right "lung" 8% tall at the apex.
    expect(partialLungs(pair([0.57, 0.1, 0.93, 0.84], [0.32, 0.12, 0.46, 0.2]))).toEqual(["right"]);
    expect(outlineRatio(pair([0.57, 0.1, 0.93, 0.84], [0.32, 0.12, 0.46, 0.2]))).toBe(0.1081);
    // U-SGF4: right lung outlined only from 0.59 down.
    expect(partialLungs(pair([0.5569, 0.1752, 0.8461, 1], [0.2047, 0.5895, 0.4451, 1]))).toEqual(["right"]);
    expect(partialLungs(pair([0.6, 0.5, 0.9, 0.9], [0.1, 0.1, 0.4, 0.9]))).toEqual(["left"]);
  });
  it("says nothing without both lungs", () => {
    expect(partialLungs([{ label: "left lung", box: [0.5, 0.1, 0.9, 0.9] }])).toEqual([]);
    expect(outlineRatio([])).toBeNull();
  });
  it("words the note for the viewer", () => {
    expect(partialNote([])).toBeNull();
    expect(partialNote(["right"])).toBe("Right lung outline incomplete: its area, density and angle measurements are not shown.");
  });
});
