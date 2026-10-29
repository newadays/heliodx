import { describe, expect, it } from "vitest";

import { redactionBox } from "./textCheck";

// The 29 Oct upload (U-YPW2): 630 × 630 film, top band 0–18 % (113 px tall).
const crop = { width: 630, height: 113 };
const band = { x: 0, y: 0, w: 1, h: 0.18 };
const w = (text: string, x0: number, y0: number, x1: number, y1: number) => ({ text, bbox: { x0, y0, x1, y1 } });
const ap = w("AP", 95, 30, 125, 40);
const erect = w("ERECT", 95, 41, 165, 50);
const hit = w("R3CT", 80, 55, 160, 66);
const marker = w("L", 480, 35, 495, 50);

describe("redactionBox", () => {
  it("covers every line of a stacked label touching the hit, not just the hit (half of ERECT showed)", () => {
    const box = redactionBox([hit], [ap, erect, hit, marker], crop, band);
    const px = (v: number) => v * 630;
    expect(px(box.y)).toBeLessThan(30); // above the top of "AP"
    expect(px(box.y + box.h)).toBeGreaterThan(66 * (0.18 * 630) / 113); // below the hit
    expect(px(box.x)).toBeLessThan(80);
    expect(px(box.x + box.w)).toBeGreaterThan(165);
    expect(px(box.x + box.w)).toBeLessThan(480); // the side marker far away stays visible
  });

  it("stays inside the image", () => {
    const box = redactionBox([w("JOHN", 0, 0, 60, 12)], [w("JOHN", 0, 0, 60, 12)], crop, band);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1);
  });
});
