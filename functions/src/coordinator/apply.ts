/**
 * B13 · Applies the coordinator's actions to studies through the StudyWriter
 * (actor "coordinator"): one audit entry and one trace row per action, in the
 * case's "coordination" stage, so the console shows a Coordinator step with
 * the Muse Wonder badge (or none when the rules fallback decided). Each
 * action is idempotent: a study is planned, requeued and escalated at most
 * once; a repeat aborts its transaction and writes nothing.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { MODELS } from "../config";
import { assertsCondition } from "../lib/vocabulary";
import { traceEvent, traceScope } from "../lib/trace";
import { WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import type { CoordinatorAction } from "./plan";
import { WATCHED_STATUSES, type Lane } from "./snapshot";

export type PlanSource = "wonder" | "rules";

class AlreadyDone extends Error {}

const RANK: Record<Lane, number> = { routine: 0, urgent: 1, critical: 2 };
const higher = (a: unknown, b: Lane): Lane => (RANK[a as Lane] ?? -1) >= RANK[b] ? (a as Lane) : b;

export interface ApplyResult {
  applied: { action: CoordinatorAction["action"]; studyId: string }[];
  skipped: { action: CoordinatorAction["action"]; studyId: string; reason: string }[];
}

/** Wonder's reason is free text: one naming a condition is replaced by a fixed one (it only sees queue state, so this is insurance). */
const FIXED_REASON: Record<CoordinatorAction["action"], string> = {
  plan_study: "Planned from the queue state.",
  requeue_study: "The model service failed; one more try.",
  escalate_to_human: "Needs a clinician's attention.",
};
export const safeReason = (a: CoordinatorAction): string => (assertsCondition(a.reason) ? FIXED_REASON[a.action] : a.reason);

export async function applyActions(db: Firestore, actions: CoordinatorAction[], source: PlanSource): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [] };
  const by = source === "wonder" ? MODELS.coordinator : "rules";
  for (const action of actions) {
    const a = { ...action, reason: safeReason(action) };
    const ref = db.collection("studies").doc(a.studyId);
    const writer = new StudyWriter(ref, "coordinator");
    try {
      await traceScope(ref, "coordination", async () => {
        if (a.action === "plan_study") {
          const lane = a.lane ?? "routine";
          await writer.updateWith(
            (data) => {
              if (data.coordinator?.plannedAt) throw new AlreadyDone();
              const priority = higher(data.priority, lane);
              return {
                fields: { priority, coordinator: { ...(data.coordinator ?? {}), plannedAt: new Date(), fromPriority: data.priority ?? null, lane: priority, radiologistReadSuggested: !!a.radiologistRead, reason: a.reason, by } },
                detail: { lane: priority, radiologistReadSuggested: !!a.radiologistRead, source },
              };
            },
            { allowedIn: ["ready", "clinician_review"], action: "coordinator_planned" },
          );
        } else if (a.action === "requeue_study") {
          await writer.updateWith(
            (data) => {
              if (data.coordinator?.requeues) throw new AlreadyDone();
              return {
                fields: { "pipeline.attempts": 0, "pipeline.lastError": FieldValue.delete(), "coordinator.requeues": 1 },
                to: "queued" as StudyStatus,
                detail: { source },
              };
            },
            { allowedIn: ["failed"], action: "coordinator_requeued" },
          );
        } else {
          await writer.updateWith(
            (data) => {
              if (data.coordinator?.escalation) throw new AlreadyDone();
              return {
                fields: { "flags.needsHuman": true, "coordinator.escalation": { reason: a.reason, at: new Date(), by } },
                detail: { source },
              };
            },
            { allowedIn: WATCHED_STATUSES, action: "coordinator_escalated" },
          );
        }
        traceEvent({
          kind: "check",
          name: a.action,
          ...(source === "wonder" ? { model: MODELS.coordinator } : {}),
          args: { ...(a.lane ? { lane: a.lane } : {}), ...(a.radiologistRead !== undefined ? { radiologistRead: a.radiologistRead } : {}), source },
          ok: true,
          result: `${a.reason}${source === "rules" ? " (rules)" : ""}`,
        });
      });
      result.applied.push({ action: a.action, studyId: a.studyId });
    } catch (error) {
      const reason = error instanceof AlreadyDone ? "already_done" : error instanceof WrongStateError ? `wrong_state_${error.stage}` : "error";
      if (reason === "error") logger.warn("coordinator: action failed", { studyId: a.studyId, action: a.action, message: error instanceof Error ? error.message : String(error) });
      result.skipped.push({ action: a.action, studyId: a.studyId, reason });
    }
  }
  return result;
}
