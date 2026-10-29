import { describe, expect, it } from "vitest";

import { demoPatient, recentCount } from "../src/lib/demo";

describe("demo helpers", () => {
  it("makes obviously fake patients", () => {
    expect(demoPatient(3)).toEqual({ name: "Sample Patient 3", phone: "+155501003", email: "sample.patient3@example.invalid" });
    expect(demoPatient(103).phone).toBe("+155501003");
  });

  it("counts starts in the rolling hour", () => {
    const now = 10 * 60 * 60 * 1000;
    expect(recentCount([now - 1000, now - 59 * 60 * 1000, now - 61 * 60 * 1000], now)).toBe(2);
  });
});
