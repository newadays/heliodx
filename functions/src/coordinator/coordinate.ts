/**
 * B13 · One coordinator tick: snapshot the queue, ask Muse Wonder for a plan
 * (route "coordination": de-identified queue state only), keep the safe part
 * of it, add the SLA sweep, apply. When Wonder is unavailable (no key, mock
 * models, an error), the rules fallback applies the same three actions.
 * Nothing is sent when nothing needs a decision.
 */
import { type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { MODEL_MOCK, MODELS } from "../config";
import { traceScope } from "../lib/trace";
import { generateJson } from "../models/client";
import { applyActions, type ApplyResult, type PlanSource } from "./apply";
import { COORDINATOR_SYSTEM, CoordinatorPlanSchema, rulePlan, slaEscalation, validatePlan, type CoordinatorAction, type CoordinatorPlan } from "./plan";
import { needsDecision, queueSnapshot, WATCHED_STATUSES, type CoordinatorStudy, type QueueItem } from "./snapshot";

export const WINDOW_MS = 24 * 60 * 60_000;

/** Asks Muse Wonder for a plan; throws when it cannot answer. */
export type Planner = (queue: QueueItem[]) => Promise<CoordinatorPlan>;

export const wonderPlanner: Planner = (queue) =>
  generateJson({
    route: "coordination",
    schema: CoordinatorPlanSchema,
    system: COORDINATOR_SYSTEM,
    prompt: "Plan this queue. Return the actions needed now.",
    context: { queue },
    step: "queued",
    temperature: 0,
    answerTokens: 1024,
    reasoningEffort: "low",
  });

export interface TickResult extends ApplyResult {
  source: PlanSource | "idle";
  considered: number;
  error?: string;
}

export async function loadQueue(db: Firestore, now: number): Promise<CoordinatorStudy[]> {
  const snap = await db
    .collection("studies")
    .where("status", "in", [...WATCHED_STATUSES])
    .where("updatedAt", ">=", new Date(now - WINDOW_MS))
    .orderBy("updatedAt", "asc")
    .limit(200)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CoordinatorStudy, "id">) })).filter((s) => !s.deletedAt);
}

/** Merges the SLA sweep into a plan: overdue, stalled and unretryable cases are escalated whatever the planner said. */
function withSweep(actions: CoordinatorAction[], queue: QueueItem[]): CoordinatorAction[] {
  const out = [...actions];
  for (const q of queue) {
    const e = slaEscalation(q);
    if (e && !out.some((a) => a.action === "escalate_to_human" && a.studyId === q.studyId)) out.push(e);
  }
  return out;
}

export async function coordinate(
  db: Firestore,
  now: number,
  deps: { planner?: Planner | null; studies?: CoordinatorStudy[] } = {},
): Promise<TickResult> {
  const studies = deps.studies ?? (await loadQueue(db, now));
  const { queue } = queueSnapshot(studies, now);
  const pending = queue.filter(needsDecision);
  const statusRef = db.collection("system").doc("coordinator");
  if (!pending.length) {
    await statusRef.set({ lastTickAt: new Date(now), source: "idle", considered: queue.length, actions: 0 }, { merge: true });
    return { source: "idle", considered: queue.length, applied: [], skipped: [] };
  }

  // Wonder sees the whole watched queue (for context), and decides on the pending part.
  const planner = deps.planner === undefined ? (MODEL_MOCK ? null : wonderPlanner) : deps.planner;
  let source: PlanSource = "rules";
  let actions: CoordinatorAction[];
  let error: string | undefined;
  const started = Date.now();
  if (planner) {
    try {
      const plan = await traceScope(statusRef, "coordination", () => planner(queue));
      actions = validatePlan(plan, queue);
      source = "wonder";
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : String(e);
      logger.warn("coordinator unavailable, fallback rules applied", { message: error });
      actions = rulePlan(queue);
    }
  } else {
    logger.info("coordinator: no planner (mock models or no key), rules applied");
    actions = rulePlan(queue);
  }
  actions = withSweep(actions, queue);

  const applied = await applyActions(db, actions, source);
  await statusRef.set(
    {
      lastTickAt: new Date(now),
      source,
      model: source === "wonder" ? MODELS.coordinator : null,
      considered: queue.length,
      pending: pending.length,
      actions: applied.applied.length,
      ms: Date.now() - started,
      error: error ?? null,
    },
    { merge: true },
  );
  logger.info("coordinator tick", { source, considered: queue.length, pending: pending.length, applied: applied.applied.length, skipped: applied.skipped.length });
  return { source, considered: queue.length, ...applied, ...(error ? { error } : {}) };
}
