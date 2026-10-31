/**
 * One typed model call: prompt (+ image or context) in, validated JSON out.
 * Both targets speak the OpenAI Chat Completions format: our GPU service
 * (vLLM serving Muse Glimmer) and the hosted Meta Model API. Every call names
 * a route (`./routes.ts`), which picks the target and refuses payloads the
 * route may not carry, before anything is sent. Handles refusal, bad JSON and
 * transport errors and maps each to a PipelineError code. Logs timings and
 * token counts only, never prompt or response text.
 */
import { logger } from "firebase-functions/v2";
import type { z } from "zod";

import { BASELINE_GPU_URL, GPU_URL, META_API_KEY, MODEL_API_BASE, MODEL_TIMEOUT_MS, REASONING_HEADROOM_TOKENS } from "../config";
import { PipelineError, type PipelineStatus } from "../pipeline/errors";
import { toResponseJsonSchema } from "../schemas/study";
import { SYSTEM_INSTRUCTION } from "./prompts";
import { gpuIdToken } from "./gpuAuth";
import { assertPayloadAllowed, resolveRoute, RouteViolation, type Route, type RouteTarget } from "./routes";
import { traceEvent } from "../lib/trace";

export interface GenerateJsonInput<S extends z.ZodType> {
  route: Route;
  schema: S;
  prompt: string;
  image?: { mimeType: string; data: Buffer };
  /** Structured, de-identified context; required shape on hosted routes. */
  context?: Record<string, unknown>;
  step: PipelineStatus;
  temperature?: number;
  /** Tokens for the answer itself; reasoning headroom is added on top. */
  answerTokens?: number;
  /**
   * Hosted models take `reasoning_effort`; Muse Glimmer reads a
   * "Reasoning strength: <level>" line in the system prompt (model card).
   * Clinical calls default to low to keep latency down.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /** Replaces the clinical system instruction (the coordinator is not a clinical agent). */
  system?: string;
}

/** `max_tokens` to request: the answer budget plus room for hidden reasoning. */
export function maxTokensFor(answerTokens: number, headroomMultiplier = 1): number {
  return answerTokens + REASONING_HEADROOM_TOKENS * headroomMultiplier;
}

/** The subset of a Chat Completions response this client reads. */
interface ChatCompletion {
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export async function generateJson<S extends z.ZodType>(input: GenerateJsonInput<S>): Promise<z.infer<S>> {
  try {
    assertPayloadAllowed(input.route, { image: input.image, context: input.context });
  } catch (error) {
    if (error instanceof RouteViolation) {
      // A programming error, never a model outcome; nothing was sent.
      logger.error("model route violation", { step: input.step, route: input.route });
      throw new PipelineError("internal", error.message, input.step);
    }
    throw error;
  }
  const target = resolveRoute(input.route, { gpuUrl: GPU_URL.value(), hostedBase: MODEL_API_BASE, baselineUrl: BASELINE_GPU_URL.value() }, input.step);

  const schema = toResponseJsonSchema(input.schema);
  const imagePart = input.image
    ? [{ type: "image_url", image_url: { url: `data:${input.image.mimeType};base64,${input.image.data.toString("base64")}` } }]
    : [];
  const contextText = input.context ? `\n\nCONTEXT:\n${JSON.stringify(input.context)}` : "";
  const answerTokens = input.answerTokens ?? 2048;

  const call = (prompt: string, headroomMultiplier = 1) =>
    withRetries(input.step, target, () =>
      post(target, {
        model: target.model,
        messages: [
          { role: "system", content: input.system ?? systemPrompt(target, input.reasoningEffort) },
          { role: "user", content: [...imagePart, { type: "text", text: prompt + contextText }] },
        ],
        temperature: input.temperature ?? 0.2,
        // Hidden reasoning only happens on hosted reasoning models; Glimmer runs
        // without its reasoning parser, so its cap is the answer budget. A
        // runaway (seen live: whitespace loops) then costs seconds, not minutes.
        max_tokens: target.hosted ? maxTokensFor(answerTokens, headroomMultiplier) : answerTokens * headroomMultiplier,
        ...(target.hosted && input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        response_format: { type: "json_schema", json_schema: { name: "draft", schema, strict: false } },
      }),
      prompt + contextText,
    );

  let first = await call(input.prompt);
  // Reasoning used the whole budget and no answer came back: once more with
  // double the headroom before treating it as a failure.
  if (isEmptyLength(first)) {
    logger.warn("model: budget spent on reasoning, re-asking with more room", { step: input.step, model: target.model });
    first = await call(input.prompt, 2);
  }
  const parsed = parse(input.schema, first, input.step);
  if (parsed.ok) return parsed.data;

  // One re-ask with the validation problems; a second miss is a hard failure.
  logger.warn("model: schema mismatch, re-asking", { step: input.step, model: target.model, issues: parsed.issues.length });
  const second = await call(
    `${input.prompt}\n\nYour previous answer did not match the schema: ${parsed.issues.slice(0, 5).join("; ")}. ` +
      "Return only valid JSON matching the schema.",
  );
  const again = parse(input.schema, second, input.step);
  if (again.ok) return again.data;
  throw new PipelineError("schema_invalid", `Model output failed validation: ${again.issues[0] ?? "unknown"}`, input.step);
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Model API returned HTTP ${status}`);
    this.name = "HttpError";
  }
}

/** Glimmer takes its reasoning level in the system prompt, not a parameter. */
export function systemPrompt(target: Pick<RouteTarget, "hosted">, effort?: "low" | "medium" | "high"): string {
  if (target.hosted) return SYSTEM_INSTRUCTION;
  return `${SYSTEM_INSTRUCTION}\nReasoning strength: ${effort ?? "low"}`;
}

function isEmptyLength(res: ChatCompletion): boolean {
  const choice = res.choices?.[0];
  return choice?.finish_reason === "length" && !(choice.message?.content ?? "").trim();
}

async function post(target: RouteTarget, body: Record<string, unknown>): Promise<ChatCompletion> {
  const bearer = target.auth === "gpu-id-token" ? await gpuIdToken(target.baseUrl) : META_API_KEY.value();
  const res = await fetch(`${target.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  // The error body may echo the request; it is never read or logged.
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as ChatCompletion;
}

function parse<S extends z.ZodType>(
  schema: S,
  res: ChatCompletion,
  step: PipelineStatus,
): { ok: true; data: z.infer<S> } | { ok: false; issues: string[] } {
  const choice = res.choices?.[0];
  if (choice?.message?.refusal) throw new PipelineError("model_refused", "The model declined this request.", step);
  if (choice?.finish_reason === "content_filter") throw new PipelineError("model_refused", "Response blocked by the content filter.", step);

  const text = choice?.message?.content ?? "";
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch {
    return { ok: false, issues: [choice?.finish_reason === "length" ? "output truncated (length)" : "response was not JSON"] };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, issues: result.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`) };
}

/** Some models wrap JSON in a ```json fence even when asked not to. */
export function stripFences(text: string): string {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return m ? m[1] : t;
}

/** Two retries on rate limiting, overload and transport timeouts, with backoff. */
async function withRetries<T extends ChatCompletion>(step: PipelineStatus, target: RouteTarget, fn: () => Promise<T>, prompt?: string): Promise<T> {
  const model = target.model;
  const delays = [1_000, 3_000];
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const out = await fn();
      const ms = Date.now() - started;
      logger.info("model call", {
        step,
        model,
        ms,
        promptTokens: out.usage?.prompt_tokens ?? null,
        outputTokens: out.usage?.completion_tokens ?? null,
        reasoningTokens: out.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        route: target.route,
        attempt,
      });
      traceEvent({
        kind: "model",
        name: `${model}.chat`,
        model,
        route: target.route,
        ms,
        promptTokens: out.usage?.prompt_tokens ?? null,
        outputTokens: out.usage?.completion_tokens ?? null,
        attempt,
        ok: true,
        args: { step },
        result: `${out.usage?.completion_tokens ?? "?"} tokens out · ${target.route} route`,
        detail: { prompt, raw: out.choices?.[0]?.message?.content ?? "" },
      });
      return out;
    } catch (error) {
      const kind = classify(error);
      logger.warn("model call failed", { step, model, route: target.route, ms: Date.now() - started, kind, attempt });
      traceEvent({ kind: "model", name: `${model}.chat`, model, route: target.route, ms: Date.now() - started, attempt, ok: false, args: { step }, result: `failed (${kind})` });
      if (kind === "retryable" && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      if (kind === "timeout") throw new PipelineError("timeout", "The model did not answer in time.", step);
      if (kind === "retryable") {
        // On the clinical route this means our own GPU service is down or
        // cold; there is deliberately no hosted fallback.
        const code = target.hosted ? "timeout" : "model_unavailable";
        throw new PipelineError(code, "The model service is busy or unavailable; please try again.", step);
      }
      throw new PipelineError("internal", error instanceof Error ? error.message : String(error), step);
    }
  }
}

export function classify(error: unknown): "retryable" | "timeout" | "fatal" {
  const e = error as { status?: number; name?: string; message?: string };
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "timeout";
  const status = Number(e?.status);
  if (status === 429 || status >= 500) return "retryable";
  const msg = (e?.message ?? "").toLowerCase();
  if (msg.includes("fetch failed") || msg.includes("econnreset")) return "retryable";
  return "fatal";
}
