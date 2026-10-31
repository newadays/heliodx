import { describe, expect, it } from "vitest";

import { findingPolarity } from "../src/lib/polarity";

describe("findingPolarity", () => {
  it("keeps the model's label, else follows a crossed threshold", () => {
    expect(findingPolarity({ polarity: "normal", evidence: { measurementIds: ["ctr"] } }, ["ctr"])).toBe("normal");
    expect(findingPolarity({ evidence: { measurementIds: ["ctr"] } }, ["ctr"])).toBe("attention");
    expect(findingPolarity({ evidence: { measurementIds: ["ctr"] } }, [])).toBe("normal");
    expect(findingPolarity({}, ["ctr"])).toBe("normal");
  });
});
