import { describe, expect, it } from "vitest";

import { reviewHash } from "../src/lib/reviewHash";

/**
 * Pinned vector shared with utils/reviewHash.test.ts (used by the web app). If either
 * side changes the algorithm, both tests fail and the stamp/compare contract
 * is reviewed deliberately.
 */
export const PINNED_INPUT = [
  { id: "f1", status: "accepted" as const },
  { id: "f2", status: "edited" as const, editedText: "Mild cardiomegaly" },
  { id: "f3", status: "rejected" as const },
];
export const PINNED_HASH = "r1-bb989e7e-3";

describe("reviewHash (functions mirror)", () => {
  it("matches the shared pinned vector", () => {
    expect(reviewHash(PINNED_INPUT)).toBe(PINNED_HASH);
  });

  it("is order-independent and sensitive to decisions", () => {
    expect(reviewHash([PINNED_INPUT[2], PINNED_INPUT[0], PINNED_INPUT[1]])).toBe(PINNED_HASH);
    expect(reviewHash([{ ...PINNED_INPUT[0], status: "rejected" }, PINNED_INPUT[1], PINNED_INPUT[2]])).not.toBe(PINNED_HASH);
  });
});
