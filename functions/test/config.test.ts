import { describe, expect, it } from "vitest";

import { LIMITS, MODEL_API_BASE, MODELS, REGION, STORAGE_REGION } from "../src/config";

describe("config", () => {
  it("keeps every function in Europe", () => {
    expect(REGION).toMatch(/^europe-/);
    expect(STORAGE_REGION).toMatch(/^europe-/);
  });

  it("routes clinical calls to Glimmer and hosted calls to Wonder and Voice Transcribe", () => {
    expect(MODEL_API_BASE).toBe("https://api.meta.ai/v1");
    expect(MODELS.clinical).toBe("glimmer");
    expect(MODELS.coordinator).toBe("muse-wonder-1.0");
    expect(MODELS.dictation).toBe("muse-voice-transcribe-1.0");
  });

  it("keeps the pipeline limits sane", () => {
    expect(LIMITS.thumbMaxPx).toBeLessThan(LIMITS.modelImageMaxPx);
    expect(LIMITS.maxFindings).toBeGreaterThan(0);
    expect(LIMITS.maxFindings).toBeLessThanOrEqual(6);
  });
});
