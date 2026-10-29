/**
 * SAM 3.1 and health on the private model service (gpu/sam_server.py).
 * Clinical by definition: the image goes only to our own GPU, never to a
 * hosted API. Glimmer chat calls go through `client.ts` (route `clinical`).
 */
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { GPU_URL, MODEL_TIMEOUT_MS } from "../config";
import { PipelineError, type PipelineStatus } from "../pipeline/errors";
import { gpuAudience, gpuIdToken } from "./gpuAuth";

export const DetectionSchema = z.object({
  prompt: z.string(),
  score: z.number().min(0).max(1),
  /** [x0, y0, x1, y1], 0-1 of width/height. */
  box: z.array(z.number().min(0).max(1)).length(4),
  area_px: z.number().int().nonnegative(),
  /** Row-major run lengths, starting with a run of false (see decodeRle). */
  rle: z.array(z.number().int().nonnegative()),
});
export const SegmentResponseSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  detections: z.array(DetectionSchema),
  ms: z.number().int().nonnegative(),
});
export type Detection = z.infer<typeof DetectionSchema>;
export type SegmentResponse = z.infer<typeof SegmentResponseSchema>;

/** Inverse of gpu/samutil.py `rle_encode`. */
export function decodeRle(counts: readonly number[], height: number, width: number): Uint8Array {
  const out = new Uint8Array(height * width);
  let pos = 0;
  let on = false;
  for (const run of counts) {
    if (on) out.fill(1, pos, pos + run);
    pos += run;
    on = !on;
  }
  if (pos !== height * width) throw new Error(`run lengths cover ${pos} pixels, expected ${height * width}`);
  return out;
}

function baseUrl(step: PipelineStatus): string {
  const root = gpuAudience(GPU_URL.value());
  if (!root) throw new PipelineError("model_unavailable", "The private model service is not configured.", step);
  return root;
}

/** Segment `prompts` (e.g. "left lung", "heart") in one image. */
export async function samSegment(
  image: Buffer,
  prompts: string[],
  step: PipelineStatus,
  threshold = 0.5,
): Promise<SegmentResponse> {
  const root = baseUrl(step);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${root}/sam/segment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await gpuIdToken(root)}` },
      body: JSON.stringify({ image_b64: image.toString("base64"), prompts, threshold }),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw new PipelineError(name === "TimeoutError" ? "timeout" : "model_unavailable", "SAM did not answer.", step);
  }
  if (res.status === 429 || res.status >= 500) {
    throw new PipelineError("model_unavailable", `SAM service returned HTTP ${res.status}.`, step);
  }
  if (!res.ok) throw new PipelineError("internal", `SAM rejected the request (HTTP ${res.status}).`, step);
  const parsed = SegmentResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new PipelineError("schema_invalid", "SAM returned an unexpected shape.", step);
  logger.info("sam call", { step, prompts: prompts.length, detections: parsed.data.detections.length, ms: Date.now() - started });
  return parsed.data;
}

export type ServiceState = "ok" | "loading" | "down" | "error" | "not_configured";

/**
 * `/health` of the private service: SAM and Glimmer separately. A cold
 * service may not answer within `timeoutMs`; that reads as "down" here while
 * Cloud Run carries on starting the instance.
 */
export async function gpuHealth(timeoutMs = 15_000): Promise<{ glimmer: ServiceState; sam: ServiceState; latencyMs: number | null }> {
  const root = gpuAudience(GPU_URL.value());
  if (!root) return { glimmer: "not_configured", sam: "not_configured", latencyMs: null };
  const started = Date.now();
  try {
    const res = await fetch(`${root}/health`, {
      headers: { authorization: `Bearer ${await gpuIdToken(root)}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as { glimmer?: string; sam?: string; detail?: { glimmer?: string; sam?: string } };
    const s = body.detail ?? body;
    const norm = (v: unknown): ServiceState => (v === "ok" || v === "loading" || v === "error" ? v : "down");
    return { glimmer: norm(s.glimmer), sam: norm(s.sam), latencyMs: Date.now() - started };
  } catch {
    return { glimmer: "down", sam: "down", latencyMs: null };
  }
}
