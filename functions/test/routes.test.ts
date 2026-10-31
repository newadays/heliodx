import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { assertAllowedModel, MODELS, REASONING_HEADROOM_TOKENS } from "../src/config";
import { generateJson, maxTokensFor, systemPrompt } from "../src/models/client";
import { assertPayloadAllowed, resolveRoute, RouteViolation } from "../src/models/routes";
import { PipelineError } from "../src/pipeline/errors";

const image = { mimeType: "image/jpeg", data: Buffer.from("x") };
const hostedBase = "https://api.meta.ai/v1";

describe("model routes", () => {
  it("sends clinical calls to our GPU service, never to the hosted API", () => {
    const t = resolveRoute("clinical", { gpuUrl: "https://heliodx-models.run.app/", hostedBase }, "detecting");
    expect(t.baseUrl).toBe("https://heliodx-models.run.app/v1");
    expect(t.hosted).toBe(false);
    expect(t.auth).toBe("gpu-id-token");
    expect(t.model).toBe(MODELS.clinical);
  });

  it("fails clinical calls with model_unavailable when the GPU is not configured", () => {
    try {
      resolveRoute("clinical", { gpuUrl: "  ", hostedBase }, "detecting");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).code).toBe("model_unavailable");
    }
  });

  it("sends the eval baseline to its own GPU service, and only when it is configured", () => {
    const t = resolveRoute("clinical_baseline", { gpuUrl: "https://heliodx-models.run.app", hostedBase, baselineUrl: "https://heliodx-baseline.run.app/" }, "detecting");
    expect(t).toMatchObject({ baseUrl: "https://heliodx-baseline.run.app/v1", hosted: false, auth: "gpu-id-token", model: MODELS.baseline });
    expect(() => resolveRoute("clinical_baseline", { gpuUrl: "https://heliodx-models.run.app", hostedBase }, "detecting")).toThrow(PipelineError);
    expect(() => assertPayloadAllowed("clinical_baseline", { image, context: { clinicalContext: "cough" } })).not.toThrow();
  });

  it("no app code selects the baseline route; only the eval runner (scripts/eval.ts) does", () => {
    const src = join(__dirname, "../src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    const naming = files(src).filter((f) => f.endsWith(".ts") && readFileSync(f, "utf8").includes("clinical_baseline"));
    expect(naming.map((f) => f.slice(src.length + 1))).toEqual(["models/routes.ts"]);
  });

  it("uses Muse Wonder and Voice Transcribe on the hosted API", () => {
    expect(resolveRoute("coordination", { gpuUrl: "", hostedBase }, "queued").model).toBe("muse-wonder-1.0");
    expect(resolveRoute("dictation", { gpuUrl: "", hostedBase }, "queued").model).toBe("muse-voice-transcribe-1.0");
  });

  it("lets the clinical route carry the image and clinical context", () => {
    expect(() => assertPayloadAllowed("clinical", { image, context: { clinicalContext: "cough" } })).not.toThrow();
  });

  it("refuses images on hosted routes", () => {
    expect(() => assertPayloadAllowed("coordination", { image })).toThrow(RouteViolation);
    expect(() => assertPayloadAllowed("dictation", { image })).toThrow(RouteViolation);
  });

  it("allows only de-identified queue fields for coordination", () => {
    const queue = {
      queue: [{ studyId: "s1", stage: "triage", priority: "urgent", ageMinutes: 4, flags: { degraded: false } }],
    };
    expect(() => assertPayloadAllowed("coordination", { context: queue })).not.toThrow();
    for (const leak of [
      { queue: [{ studyId: "s1", patientName: "Jane" }] },
      { studies: [{ studyId: "s1", clinicalContext: "cough" }] },
      { findings: [] },
      { queue: [{ studyId: "s1", phone: "+234" }] },
    ]) {
      expect(() => assertPayloadAllowed("coordination", { context: leak })).toThrow(RouteViolation);
    }
  });

  it("keeps dictation to audio only", () => {
    expect(() => assertPayloadAllowed("dictation", { audio: Buffer.from("a") })).not.toThrow();
    expect(() => assertPayloadAllowed("dictation", { context: { studyId: "s1" } })).toThrow(RouteViolation);
  });
});

describe("model budget and policy", () => {
  it("adds reasoning headroom on top of the answer budget", () => {
    expect(maxTokensFor(2048)).toBe(2048 + REASONING_HEADROOM_TOKENS);
    expect(maxTokensFor(2048, 2)).toBe(2048 + 2 * REASONING_HEADROOM_TOKENS);
  });

  it("sets Glimmer's reasoning strength in the system prompt, defaulting to low", () => {
    expect(systemPrompt({ hosted: false })).toMatch(/Reasoning strength: low$/);
    expect(systemPrompt({ hosted: false }, "medium")).toMatch(/Reasoning strength: medium$/);
    expect(systemPrompt({ hosted: true }, "medium")).not.toMatch(/Reasoning strength/);
  });

  it("refuses contributor model variants", () => {
    expect(() => assertAllowedModel("muse-spark-1.3-contributor")).toThrow();
    expect(() => assertAllowedModel("muse-wonder-1.0")).not.toThrow();
  });
});

describe("generateJson in private mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GPU_URL;
  });

  it("makes no network request when the GPU service is not configured", async () => {
    delete process.env.GPU_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      generateJson({ route: "clinical", schema: z.object({ ok: z.boolean() }), prompt: "p", image, step: "detecting" }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a hosted call that carries an image before sending", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      generateJson({ route: "coordination", schema: z.object({ ok: z.boolean() }), prompt: "p", image, step: "queued" }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
