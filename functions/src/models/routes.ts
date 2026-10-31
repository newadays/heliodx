/**
 * Private-mode routing. Every model call names a route, and the route decides
 * where the request may go and what it may carry:
 *
 *  - `clinical`     → our own GPU service (Muse Glimmer on vLLM), in the EU.
 *                     May carry the image, clinical context and report text.
 *  - `coordination` → hosted Meta Model API (Muse Wonder). De-identified queue
 *                     state only: no image, and context keys from an allowlist.
 *  - `dictation`    → hosted Meta Model API (Muse Voice Transcribe). Audio only.
 *  - `clinical_baseline` → the eval baseline (MedGemma 27B) on its own GPU
 *                     service in the EU. Same data rules as `clinical`. Only
 *                     the eval runner selects it; app code never does.
 *
 * Clinical calls never fall back to the hosted API. This is enforced here, in
 * code, before any network request is made.
 */
import { MODELS } from "../config";
import { PipelineError, type PipelineStatus } from "../pipeline/errors";

export type Route = "clinical" | "clinical_baseline" | "coordination" | "dictation";

export interface RouteTarget {
  route: Route;
  baseUrl: string;
  model: string;
  /** Hosted targets get the Meta API key; the GPU gets a Google ID token. */
  auth: "gpu-id-token" | "meta-api-key";
  hosted: boolean;
}

export function resolveRoute(
  route: Route,
  env: { gpuUrl: string; hostedBase: string; baselineUrl?: string },
  step: PipelineStatus,
): RouteTarget {
  if (route === "clinical" || route === "clinical_baseline") {
    const gpu = (route === "clinical" ? env.gpuUrl : env.baselineUrl ?? "").trim().replace(/\/+$/, "");
    if (!gpu) {
      throw new PipelineError("model_unavailable", `The ${route === "clinical" ? "private model" : "baseline model"} service is not configured.`, step);
    }
    const model = route === "clinical" ? MODELS.clinical : MODELS.baseline;
    return { route, baseUrl: `${gpu}/v1`, model, auth: "gpu-id-token", hosted: false };
  }
  const model = route === "coordination" ? MODELS.coordinator : MODELS.dictation;
  return { route, baseUrl: env.hostedBase, model, auth: "meta-api-key", hosted: true };
}

/**
 * Keys a coordination context may contain, at any depth. An allowlist, not a
 * denylist: a new field has to be added here on purpose before it can reach a
 * hosted model.
 */
export const COORDINATION_KEYS = new Set([
  "queue",
  "studies",
  "studyId",
  "stage",
  "status",
  "priority",
  "ageMinutes",
  "slaMinutesLeft",
  "assignee",
  "lastAction",
  "flags",
  "needsRetake",
  "degraded",
  "needsHuman",
  "roster",
  "radiologistId",
  "load",
  "medianResponseMinutes",
  "available",
  "tiers",
  "healthy",
  "recentDecisions",
  "action",
  "at",
]);

export class RouteViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteViolation";
  }
}

export interface OutboundCall {
  image?: unknown;
  audio?: unknown;
  context?: unknown;
}

/** Throws RouteViolation when a call would carry data its route may not. */
export function assertPayloadAllowed(route: Route, call: OutboundCall): void {
  if (route === "clinical" || route === "clinical_baseline") return;
  if (call.image !== undefined) throw new RouteViolation(`Images may not be sent on the ${route} route.`);
  if (route === "dictation") {
    if (call.context !== undefined) throw new RouteViolation("The dictation route carries audio only.");
    return;
  }
  if (call.audio !== undefined) throw new RouteViolation("Audio may not be sent on the coordination route.");
  const bad = disallowedKeys(call.context);
  if (bad.length) throw new RouteViolation(`Coordination context has fields that are not allowed: ${bad.join(", ")}.`);
}

function disallowedKeys(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => disallowedKeys(n, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!COORDINATION_KEYS.has(k)) out.push(k);
      disallowedKeys(v, out);
    }
  }
  return out;
}
