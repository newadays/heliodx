import { describe, expect, it } from "vitest";

import { findingFields } from "../src/lib/findingFields";
import { parseLocation } from "../src/lib/location";
import { unionBox, zoneOutlines } from "../src/lib/zone";
import { polarityOf } from "../src/lib/evidence";

describe("parseLocation", () => {
  it("reads side, zone and heart from the model's text", () => {
    expect(parseLocation("right lung upper zone")).toEqual({ sides: ["right"], zone: "upper", heart: false });
    expect(parseLocation("Both lungs, upper zones")).toEqual({ sides: ["right", "left"], zone: "upper", heart: false });
    expect(parseLocation("bilateral apical")).toEqual({ sides: ["right", "left"], zone: "upper", heart: false });
    expect(parseLocation("left base")).toEqual({ sides: ["left"], zone: "lower", heart: false });
    expect(parseLocation("left mid zone")).toEqual({ sides: ["left"], zone: "middle", heart: false });
    expect(parseLocation("heart")).toEqual({ sides: [], zone: null, heart: true });
  });
  it("gives no sides for unknown or empty text", () => {
    expect(parseLocation("none")).toEqual({ sides: [], zone: null, heart: false });
    expect(parseLocation("somewhere")).toEqual({ sides: [], zone: null, heart: false });
    expect(parseLocation(undefined)).toEqual({ sides: [], zone: null, heart: false });
    expect(parseLocation("bright area")).toEqual({ sides: [], zone: null, heart: false }); // "right" inside a word
  });
});

const lungs = [
  { label: "right lung", box: [0.1, 0.2, 0.45, 0.8] as [number, number, number, number] },
  { label: "left lung", box: [0.55, 0.1, 0.9, 0.9] as [number, number, number, number] },
];

describe("zoneOutlines", () => {
  it("uses that lung's width and a third of the chest's height", () => {
    // Chest spans 0.1–0.9 across both lungs, so the right upper zone starts at 0.1 even though its mask starts at 0.2.
    expect(zoneOutlines(parseLocation("right lung upper zone"), lungs, null)).toEqual([
      { kind: "zone", side: "right", zone: "upper", box: [0.1, 0.1, 0.45, 0.367] },
    ]);
    expect(zoneOutlines(parseLocation("left lower zone"), lungs, null)[0].box).toEqual([0.55, 0.633, 0.9, 0.9]);
  });
  it("gives one outline per side, the whole lung without a zone, and the heart region for the heart", () => {
    expect(zoneOutlines(parseLocation("both upper zones"), lungs, null).map((o) => o.side)).toEqual(["right", "left"]);
    expect(zoneOutlines(parseLocation("left lung"), lungs, null)).toEqual([{ kind: "lung", side: "left", zone: null, box: [0.55, 0.1, 0.9, 0.9] }]);
    expect(zoneOutlines(parseLocation("heart"), lungs, [0.4, 0.5, 0.6, 0.8])).toEqual([{ kind: "heart", side: null, zone: null, box: [0.4, 0.5, 0.6, 0.8] }]);
    expect(zoneOutlines(parseLocation("somewhere"), lungs, null)).toEqual([]);
  });
  it("mirrors the other lung when one mask is missing", () => {
    expect(zoneOutlines(parseLocation("right lung"), [lungs[1]], null)[0].box).toEqual([0.1, 0.1, 0.45, 0.9]);
  });
  it("unions boxes for the finding's region", () => {
    expect(unionBox(zoneOutlines(parseLocation("both upper zones"), lungs, null))).toEqual([0.1, 0.1, 0.9, 0.367]);
    expect(unionBox([])).toBeNull();
  });
});

describe("polarity with the model's abnormal call", () => {
  it("is attention when abnormal or a cited measurement crossed its threshold", () => {
    expect(polarityOf([], [], true)).toBe("attention");
    expect(polarityOf(["cardiothoracic_ratio"], [{ measurementId: "cardiothoracic_ratio" }])).toBe("attention");
    expect(polarityOf(["cardiothoracic_ratio"], [], false)).toBe("normal");
  });
  it("places one marker per outlined zone", () => {
    const outlines = zoneOutlines(parseLocation("both upper zones"), lungs, null);
    const fields = findingFields(
      { index: 0, region: null, evidence: { measurementIds: [], maskIds: ["right-lung"] }, abnormal: true, outlines },
      { measurements: [], flags: [], masks: lungs },
    );
    expect(fields.polarity).toBe("attention");
    expect(fields.regions).toEqual([
      { x: 0.275, y: 0.233, label: "right lung upper zone" },
      { x: 0.725, y: 0.233, label: "left lung upper zone" },
    ]);
  });
});
