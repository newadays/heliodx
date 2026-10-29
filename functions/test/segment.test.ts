import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { maskIdFor } from "../src/tools/anatomy";
import { renderOverlay } from "../src/tools/overlay";
import { confirmStudyType, iou, pickBest, type MaskRecord } from "../src/tools/segment";

const det = (prompt: string, score: number, box = [0, 0, 0.5, 0.5]) => ({ prompt, score, box, area_px: 10, rle: [] });

describe("pickBest", () => {
  it("keeps the highest-scoring detection per label above its threshold", () => {
    const best = pickBest(
      [det("left lung", 0.6), det("left lung", 0.8), det("right lung", 0.4), det("lung", 0.9)],
      ["left lung", "right lung"],
    );
    expect(best.get("left lung")?.score).toBe(0.8);
    expect(best.has("right lung")).toBe(false); // 0.4 < 0.5
    expect(best.size).toBe(1); // a prompt we did not ask for is ignored
  });
});

describe("maskIdFor", () => {
  it("makes stable, path-safe ids", () => {
    expect(maskIdFor("left lung")).toBe("left-lung");
    expect(maskIdFor(" Heart ")).toBe("heart");
  });
});

const rec = (label: MaskRecord["label"], box: MaskRecord["box"], score = 0.7): MaskRecord => ({
  label, maskId: maskIdFor(label), score, box, areaPx: 1, width: 10, height: 10, path: "x",
});

describe("confirmStudyType", () => {
  // Radiological convention: the patient's left lung is on the image's right.
  const left = rec("left lung", [0.52, 0.07, 0.91, 0.96]);
  const right = rec("right lung", [0.07, 0.09, 0.46, 0.97]);

  it("confirms a chest X-ray with both lungs on the expected sides (live probe boxes)", () => {
    expect(confirmStudyType([left, right])).toEqual({ chestXray: true, reason: "ok" });
  });
  it("refuses missing lungs, swapped sides, low scores and the same region twice", () => {
    expect(confirmStudyType([left]).reason).toBe("lungs_not_found");
    expect(confirmStudyType([{ ...left, box: right.box }, { ...right, box: left.box }]).reason).toBe("sides_swapped");
    expect(confirmStudyType([{ ...left, score: 0.2 }, right]).reason).toBe("low_score");
    expect(confirmStudyType([left, { ...right, box: [0.5, 0.07, 0.9, 0.96] }]).reason).toBe("same_region");
  });
});

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou([0, 0, 1, 1], [0, 0, 1, 1])).toBe(1);
    expect(iou([0, 0, 0.4, 1], [0.6, 0, 1, 1])).toBe(0);
  });
});

describe("renderOverlay", () => {
  it("colours mask pixels at 35% opacity and leaves the rest transparent", async () => {
    const w = 4, h = 2;
    const mask = Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]);
    const png = await renderOverlay(mask, w, h, "#4A90E2");
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([4, 2, 4]);
    expect(Array.from(data.subarray(0, 4))).toEqual([0x4a, 0x90, 0xe2, 89]);
    expect(data[4 * 1 + 3]).toBe(0);
    expect(data[4 * 7 + 3]).toBe(89);
  });

  it("scales large masks down to 1024 px on the long edge", async () => {
    const w = 2048, h = 1024;
    const png = await renderOverlay(new Uint8Array(w * h), w, h, "#F5B400");
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 512]);
  });
});
