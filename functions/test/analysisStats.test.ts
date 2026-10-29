import { describe, expect, it } from "vitest";

import { median } from "../src/lib/analysisStats";

describe("median", () => {
  it("ignores bad values and handles even counts", () => {
    expect(median([])).toBeNull();
    expect(median([30_000, 10_000, 20_000])).toBe(20_000);
    expect(median([10_000, 20_000, 0, NaN, 40_000, 30_000])).toBe(25_000);
  });
});
