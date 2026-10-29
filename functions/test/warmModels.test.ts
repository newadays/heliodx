import { describe, expect, it } from "vitest";

import { shouldWarm, WARM_INTERVAL_MS } from "../src/callables/warmModels";

describe("shouldWarm", () => {
  const now = 1_000_000_000;
  it("pings on the first sign-in", () => expect(shouldWarm(null, now)).toBe(true));
  it("skips sign-ins within the interval, across all users", () => {
    expect(shouldWarm(now - WARM_INTERVAL_MS + 1, now)).toBe(false);
  });
  it("pings again once the interval has passed", () => expect(shouldWarm(now - WARM_INTERVAL_MS, now)).toBe(true));
});
