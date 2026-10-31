/**
 * B19 · Per-case trace for the judges' console. Every model call, SAM call
 * and code-computed check made for a study is recorded as one document in
 * `studies/{id}/trace`, so the console can show *how* the agents worked:
 * stage, tool name, small arguments, a one-line result, latency and tokens.
 *
 * A trace scope is opened around a pipeline run or a callable with
 * `traceScope(ref, stage, fn)`; code deep inside (the model client, the
 * segmentation tool) records with `traceEvent(...)` without any plumbing,
 * via AsyncLocalStorage. Outside a scope, `traceEvent` does nothing.
 *
 * Best effort: a failed trace write is logged and never fails the run.
 * Never record clinical text (prompts, answers, findings, summaries):
 * arguments are ids, labels and numbers; results are one line built in code.
 * The one exception is `detail` (a model call's prompt and raw answer, for
 * the console's Prompt / Raw output tabs), kept only for studies in the
 * synthetic demo organization and dropped for every other study.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

export type TraceKind = "model" | "tool" | "check";

export interface TraceEntry {
  at: Timestamp;
  /** Monotonic within a scope, for stable ordering of same-millisecond events. */
  seq: number;
  /** Study status (pipeline) or callable stage when the call was made. */
  stage: string;
  kind: TraceKind;
  /** e.g. "glimmer.chat", "sam.segment_region", "measure_ratio", "set_priority". */
  name: string;
  model?: string;
  route?: string;
  ms?: number;
  promptTokens?: number | null;
  outputTokens?: number | null;
  attempt?: number;
  ok: boolean;
  /** Small JSON-able arguments: ids, labels, numbers. Never clinical text. */
  args?: Record<string, unknown>;
  /** One line, built in code. */
  result?: string;
  /** Storage path of an overlay to show as a thumbnail (segment calls). */
  overlayPath?: string;
  /** Demo organization only (see above): the prompt and the raw answer, truncated. */
  detail?: { prompt?: string; raw?: string };
}

export const DETAIL_ORG = "demo";
const DETAIL_MAX = 8000;

interface Scope {
  ref: DocumentReference | null;
  /** Set by `traceCapture`: events go here, nothing is written. */
  sink?: (event: CapturedEvent) => void;
  stage: string;
  seq: number;
  writes: Promise<unknown>[];
  /** Whether `detail` may be kept: the study is in the demo organization. Looked up once. */
  detailAllowed?: Promise<boolean>;
}

const als = new AsyncLocalStorage<Scope>();

/** Runs `fn` with a trace scope for this study; waits for pending trace writes before returning. */
export async function traceScope<T>(ref: DocumentReference, stage: string, fn: () => Promise<T>): Promise<T> {
  const parent = als.getStore();
  const scope: Scope = { ref, stage, seq: parent?.ref?.path === ref.path ? parent.seq : 0, writes: [] };
  try {
    return await als.run(scope, fn);
  } finally {
    await Promise.allSettled(scope.writes);
    if (parent && parent.ref?.path === ref.path) parent.seq = scope.seq;
  }
}

export type CapturedEvent = EventInput & { stage: string };

/**
 * Runs `fn` with a trace scope that hands every event to `sink` and writes
 * nothing. The eval runner (scripts/eval.ts) uses it to read each model call's
 * latency, tokens and raw answer.
 */
export async function traceCapture<T>(stage: string, sink: (event: CapturedEvent) => void, fn: () => Promise<T>): Promise<T> {
  return als.run({ ref: null, sink, stage, seq: 0, writes: [] }, fn);
}

/** The current stage changes as the pipeline advances. */
export function setTraceStage(stage: string): void {
  const scope = als.getStore();
  if (scope) scope.stage = stage;
}

export function currentTraceStage(): string | null {
  return als.getStore()?.stage ?? null;
}

type EventInput = Omit<TraceEntry, "at" | "seq" | "stage"> & { stage?: string };

/** Records one event in the current scope (no-op outside a scope). Returns immediately. */
export function traceEvent(input: EventInput): void {
  const scope = als.getStore();
  if (!scope) return;
  if (scope.sink) {
    scope.sink({ ...input, stage: input.stage ?? scope.stage });
    return;
  }
  const ref = scope.ref!;
  const { detail, ...rest } = input;
  const entry = clean({ ...rest, stage: input.stage ?? scope.stage, at: Timestamp.now(), seq: ++scope.seq });
  if (detail) {
    scope.detailAllowed ??= ref.get().then((s) => s.get("orgId") === DETAIL_ORG).catch(() => false);
  }
  const withDetail = detail
    ? scope.detailAllowed!.then((ok) =>
        ok ? { ...entry, detail: clean({ prompt: detail.prompt?.slice(0, DETAIL_MAX), raw: detail.raw?.slice(0, DETAIL_MAX) }) } : entry,
      )
    : Promise.resolve(entry);
  const write = withDetail
    .then((e) => ref.collection("trace").add(e))
    .catch((error: unknown) => {
      logger.warn("trace write failed", { study: ref.id, name: input.name, message: error instanceof Error ? error.message : String(error) });
    });
  scope.writes.push(write);
}

/** Times `fn` and records it as a tool call; `describe` turns the result into the one-line summary. */
export async function traced<T>(
  name: string,
  args: Record<string, unknown>,
  fn: () => Promise<T> | T,
  describe: (out: T) => { result: string; overlayPath?: string; ok?: boolean },
): Promise<T> {
  const started = Date.now();
  try {
    const out = await fn();
    const d = describe(out);
    traceEvent({ kind: "tool", name, args, ms: Date.now() - started, ok: d.ok ?? true, result: d.result, overlayPath: d.overlayPath });
    return out;
  } catch (error) {
    traceEvent({ kind: "tool", name, args, ms: Date.now() - started, ok: false, result: error instanceof Error ? error.name : "error" });
    throw error;
  }
}

/** Drops undefined fields (Firestore rejects them). */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

