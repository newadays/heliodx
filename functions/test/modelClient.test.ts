import { describe, expect, it } from "vitest";

import { classify, stripFences } from "../src/models/client";

describe("model client helpers", () => {
  it("strips a json code fence", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it("classifies transport errors", () => {
    expect(classify({ name: "TimeoutError" })).toBe("timeout");
    expect(classify({ status: 429 })).toBe("retryable");
    expect(classify({ status: 503 })).toBe("retryable");
    expect(classify({ status: 400 })).toBe("fatal");
    expect(classify(new Error("fetch failed"))).toBe("retryable");
  });
});
