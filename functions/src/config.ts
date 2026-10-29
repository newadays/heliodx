/**
 * Runtime configuration for HelioDX Cloud Functions.
 *
 * Dev and prod share one Google Cloud project (heliodx, EU), so
 * nothing here branches on project id. Values that differ per deployment are
 * read from the environment so an emulator run and a deploy use the same code.
 */

import { defineSecret } from "firebase-functions/params";

/** Where the callables and scheduled functions run (the app calls this region). */
export const REGION = "europe-west1";

/**
 * Where the Storage bucket and the GPU service live. A Storage-triggered
 * function must run in its bucket's region, so the upload trigger runs here,
 * next to the GPU it calls.
 */
export const STORAGE_REGION = "europe-west4";

export const PROJECT_ID =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "heliodx";

/**
 * Model routing (private mode). Clinical data (image, clinical context,
 * findings, reports) goes only to our own GPU service in the EU, which
 * serves Muse Glimmer on vLLM and SAM 3.1. The hosted Meta Model API is used
 * only for coordination on de-identified queue state (Muse Wonder) and for
 * dictation (Muse Voice Transcribe). `src/models/routes.ts` enforces this.
 */

/**
 * Base URL of the Cloud Run GPU service; empty until it is deployed. Set it
 * in `functions/.env.heliodx` (loaded by the Firebase CLI on deploy). Read
 * from the environment rather than a Firebase param so the emulator never
 * stops to prompt for it.
 */
export const GPU_URL = { value: (): string => process.env.GPU_URL ?? "" };

/** The hosted Meta Model API key, from Secret Manager (`META_API_KEY`). */
export const META_API_KEY = defineSecret("META_API_KEY");
export const MODEL_API_BASE = process.env.MODEL_API_BASE ?? "https://api.meta.ai/v1";
export const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 90_000);

/**
 * Tokens added on top of each call's answer budget. Reasoning models count
 * their hidden reasoning against `max_tokens`; without headroom a short
 * budget returns an empty answer (verified on the Meta API, 2026-10-27).
 */
export const REASONING_HEADROOM_TOKENS = 4_000;

/** Model id per route. `glimmer` is the vLLM served-model-name on the GPU. */
export const MODELS = {
  clinical: process.env.MODEL_CLINICAL ?? "glimmer",
  coordinator: process.env.MODEL_COORDINATOR ?? "muse-wonder-1.0",
  dictation: process.env.MODEL_DICTATION ?? "muse-voice-transcribe-1.0",
} as const;

/** Contributor variants are excluded from HelioDX by policy. */
export function assertAllowedModel(id: string): void {
  if (/-contributor$/i.test(id)) throw new Error(`Model ${id} is not allowed: contributor variants are excluded.`);
}
Object.values(MODELS).forEach(assertAllowedModel);

/**
 * When "1", the pipeline returns fixtures instead of calling a model, so the
 * emulator flow works offline, in CI and without a key. Never set in a
 * deployed function.
 */
export const MODEL_MOCK = process.env.MODEL_MOCK === "1";

/** True inside the Functions emulator. */
export const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === "true";

/** Pipeline limits. */
export const LIMITS = {
  /** Longest edge of the copy sent to the model, in pixels. */
  modelImageMaxPx: 2048,
  /** Longest edge of the thumbnail written next to the original. */
  thumbMaxPx: 512,
  /** Hard cap on findings per study. */
  maxFindings: 6,
} as const;
