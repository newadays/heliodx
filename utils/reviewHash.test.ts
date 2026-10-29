import { describe, expect, it } from "vitest";
import { reviewHash, reviewProgress, reviewProgressLabel, summariesStale } from "./reviewHash";

const base = [
  { id: "f1", status: "accepted" as const },
  { id: "f2", status: "pending" as const },
  { id: "f3", status: "edited" as const, editedText: "Mild cardiomegaly" },
];

describe("reviewHash", () => {
  it("matches the vector pinned in functions/test/reviewHash.test.ts", () => {
    // Both packages compute this hash; the Functions side stamps it on the
    // summaries and the app compares. Change both tests together, never one.
    expect(
      reviewHash([
        { id: "f1", status: "accepted" },
        { id: "f2", status: "edited", editedText: "Mild cardiomegaly" },
        { id: "f3", status: "rejected" },
      ]),
    ).toBe("r1-bb989e7e-3");
  });

  it("is stable for the same decisions regardless of order", () => {
    expect(reviewHash(base)).toBe(reviewHash([base[2], base[0], base[1]]));
    expect(reviewHash(base)).toMatch(/^r1-[0-9a-f]{8}-3$/);
  });

  it("changes when a status or edited text changes", () => {
    const h = reviewHash(base);
    expect(reviewHash([{ ...base[0], status: "rejected" }, base[1], base[2]])).not.toBe(h);
    expect(reviewHash([base[0], base[1], { ...base[2], editedText: "Moderate cardiomegaly" }])).not.toBe(h);
  });

  it("ignores whitespace-only differences in edited text and treats null as empty", () => {
    expect(reviewHash([{ id: "a", status: "edited", editedText: " x " }])).toBe(
      reviewHash([{ id: "a", status: "edited", editedText: "x" }]),
    );
    expect(reviewHash([{ id: "a", status: "accepted", editedText: null }])).toBe(
      reviewHash([{ id: "a", status: "accepted" }]),
    );
  });

  it("differs for an empty review and encodes the count", () => {
    expect(reviewHash([])).toMatch(/-0$/);
    expect(reviewHash([])).not.toBe(reviewHash([{ id: "a", status: "pending" }]));
  });
});

describe("reviewProgress", () => {
  it("counts decisions, not acceptances, as reviewed; rejected counts as reviewed but not included", () => {
    const p = reviewProgress([
      { id: "a", status: "accepted" },
      { id: "b", status: "rejected" },
      { id: "c", status: "pending" },
      { id: "d", status: "edited", editedText: "x" },
    ]);
    expect(p).toEqual({ reviewed: 3, total: 4, complete: false, included: 2 });
    expect(reviewProgressLabel(p)).toBe("3 of 4 reviewed");
  });

  it("is complete only when nothing is pending, including the empty case", () => {
    expect(reviewProgress([{ id: "a", status: "accepted" }]).complete).toBe(true);
    expect(reviewProgress([]).complete).toBe(true);
  });
});

describe("summariesStale", () => {
  it("is stale when never generated or generated from another review", () => {
    expect(summariesStale("r1-aaaa-1", null)).toBe(true);
    expect(summariesStale("r1-aaaa-1", "r1-bbbb-1")).toBe(true);
    expect(summariesStale("r1-aaaa-1", "r1-aaaa-1")).toBe(false);
  });
});
