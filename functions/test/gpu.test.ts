import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/models/gpuAuth", async (orig) => ({
  ...(await orig<typeof import("../src/models/gpuAuth")>()),
  gpuIdToken: vi.fn(async () => "test-id-token"),
}));

import { decodeRle, gpuHealth, samSegment } from "../src/models/gpu";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "fixtures", "rle.json"), "utf8")) as {
  cases: { height: number; width: number; rle: number[]; mask: number[] }[];
};

describe("decodeRle", () => {
  it("decodes every mask the Python server encoder produced", () => {
    for (const c of fixture.cases) {
      expect(Array.from(decodeRle(c.rle, c.height, c.width))).toEqual(c.mask);
    }
  });

  it("rejects run lengths that do not cover the image", () => {
    expect(() => decodeRle([2, 2], 3, 3)).toThrow();
  });
});

const png = Buffer.from("fake-image");
const ok = {
  width: 100,
  height: 80,
  ms: 42,
  detections: [{ prompt: "heart", score: 0.91, box: [0.3, 0.4, 0.6, 0.8], area_px: 1200, rle: [10, 5, 7985] }],
};
const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("samSegment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GPU_URL;
  });

  it("fails fast with model_unavailable and sends nothing when the GPU is not configured", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(samSegment(png, ["heart"], "classifying")).rejects.toMatchObject({ code: "model_unavailable" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls our GPU service with an ID token and returns validated detections", async () => {
    process.env.GPU_URL = "https://heliodx-models-x.a.run.app/";
    const spy = respond(200, ok);
    const out = await samSegment(png, ["heart"], "classifying");
    expect(out.detections[0].prompt).toBe("heart");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://heliodx-models-x.a.run.app/sam/segment");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-id-token");
    expect(JSON.parse(init.body as string)).toMatchObject({ prompts: ["heart"], image_b64: png.toString("base64") });
  });

  it("treats a 5xx or 429 as the service being unavailable, so the study is requeued", async () => {
    process.env.GPU_URL = "https://svc.run.app";
    respond(503, { detail: "loading" });
    await expect(samSegment(png, ["heart"], "classifying")).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("rejects an unexpected response shape", async () => {
    process.env.GPU_URL = "https://svc.run.app";
    respond(200, { width: 1, height: 1, ms: 1, detections: [{ prompt: "x", score: 3 }] });
    await expect(samSegment(png, ["heart"], "classifying")).rejects.toMatchObject({ code: "schema_invalid" });
  });
});

describe("gpuHealth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GPU_URL;
  });

  it("reports not_configured without a GPU_URL", async () => {
    expect(await gpuHealth()).toEqual({ glimmer: "not_configured", sam: "not_configured", latencyMs: null });
  });

  it("reads per-model state from a 503 while Glimmer is still loading", async () => {
    process.env.GPU_URL = "https://svc.run.app";
    respond(503, { detail: { sam: "ok", glimmer: "down" } });
    const h = await gpuHealth();
    expect(h.sam).toBe("ok");
    expect(h.glimmer).toBe("down");
  });
});
