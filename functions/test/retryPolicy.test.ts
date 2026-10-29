import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isTransient, isWarmingWait, MAX_ATTEMPTS, MAX_WARMING_WAIT_MS, nextStep } from "../src/pipeline/retryPolicy";

describe("retry policy", () => {
  it("retries only when the model service was down or slow", () => {
    expect(isTransient("model_unavailable")).toBe(true);
    expect(isTransient("timeout")).toBe(true);
    for (const code of ["quality_rejected", "model_refused", "schema_invalid", "internal"] as const) {
      expect(isTransient(code)).toBe(false);
      expect(nextStep(code, 0)).toBe("fail");
    }
  });

  it(`requeues until ${MAX_ATTEMPTS} automatic attempts, then fails`, () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(nextStep("model_unavailable", 0)).toBe("requeue");
    expect(nextStep("model_unavailable", 1)).toBe("requeue");
    expect(nextStep("model_unavailable", 2)).toBe("fail");
    expect(nextStep("timeout", 5)).toBe("fail");
  });
});

describe("waiting for a cold GPU", () => {
  it("requeues without counting the attempt, however many came before", () => {
    expect(nextStep("model_unavailable", 5, { countAttempt: false })).toBe("requeue");
  });
  it("still fails a real outcome immediately", () => {
    expect(nextStep("quality_rejected", 0, { countAttempt: false })).toBe("fail");
  });
  it("only counts as warming within the window after the study was created", () => {
    const now = 1_000_000_000;
    expect(isWarmingWait(now - 60_000, now)).toBe(true);
    expect(isWarmingWait(now - MAX_WARMING_WAIT_MS, now)).toBe(false);
    expect(isWarmingWait(null, now)).toBe(false);
  });
});

describe("no patient details on the model path", () => {
  // Static check, like the app's PHI guard: the code that builds model calls
  // never reads the study's patient block.
  const files = [
    "src/pipeline/run.ts",
    "src/pipeline/image.ts",
    "src/models/client.ts",
    "src/models/prompts.ts",
    "src/models/routes.ts",
    "src/models/gpu.ts",
    "src/callables/warmModels.ts",
    "src/stages/intake.ts",
    "src/stages/triage.ts",
    "src/stages/prep.ts",
    "src/tools/segment.ts",
    "src/tools/measure.ts",
    "src/callables/regenerateSummaries.ts",
    "src/scheduled/requeueStudies.ts",
  ];
  for (const f of files) {
    it(`${f} does not touch patient name, phone or email`, () => {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src).not.toMatch(/\.patient\b|\["patient"\]|patient\.(name|phone|email)|patientName|patientPhone|patientEmail/);
    });
  }
});
