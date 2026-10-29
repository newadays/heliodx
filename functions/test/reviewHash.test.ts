import { describe, expect, it } from "vitest";

import { acceptAllHash, reviewHash } from "../src/lib/reviewHash";
import { signNeeds } from "../src/lib/report";

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

describe("acceptAllHash", () => {
  const drafted = [{ id: "a", status: "pending" as const }, { id: "b", status: "pending" as const }];
  const stamp = acceptAllHash(drafted);

  it("matches the review the clinician produces by accepting every finding", () => {
    expect(reviewHash([{ id: "a", status: "accepted" }, { id: "b", status: "accepted" }])).toBe(stamp);
    expect(reviewHash([{ id: "a", status: "accepted" }, { id: "b", status: "rejected" }])).not.toBe(stamp);
    expect(reviewHash([{ id: "a", status: "accepted" }, { id: "b", status: "edited", editedText: "x" }])).not.toBe(stamp);
  });

  it("lets an accept-all review sign without a redraft; any other review still needs one", () => {
    const summary = { impression: ["Enlarged cardiac silhouette."], recommendation: "Clinical correlation.", generatedFromReviewHash: stamp, editedByClinician: false };
    const accepted = [{ id: "a", status: "accepted" as const }, { id: "b", status: "accepted" as const }];
    expect(signNeeds({ findings: accepted, clinicianSummary: summary }, { confirmImpression: true })).toEqual([]);
    const oneRejected = [{ id: "a", status: "accepted" as const }, { id: "b", status: "rejected" as const }];
    expect(signNeeds({ findings: oneRejected, clinicianSummary: summary }, { confirmImpression: true })).toContain("refresh_summary");
  });
});
