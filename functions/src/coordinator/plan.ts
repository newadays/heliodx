/**
 * B13 · The coordinator's plan: three actions over the de-identified queue.
 * Muse Wonder proposes it; `validatePlan` keeps only what is safe to apply,
 * so a model mistake can never lower a priority, requeue a healthy study or
 * act on a study outside the snapshot. `rulePlan` is the same three actions
 * in plain code, used when Wonder is unavailable, and as the SLA sweep.
 */
import { z } from "zod";

import type { Lane, QueueItem } from "./snapshot";

export const CoordinatorPlanSchema = z.object({
  actions: z
    .array(
      z.object({
        action: z.enum(["plan_study", "requeue_study", "escalate_to_human"]),
        studyId: z.string().min(1).max(64),
        lane: z.enum(["routine", "urgent", "critical"]).optional().describe("plan_study only: the reading lane, never below the study's priority."),
        radiologistRead: z.boolean().optional().describe("plan_study only: whether a radiologist should read it before signing."),
        reason: z.string().min(1).max(160).describe("One short sentence; queue facts only, never clinical words."),
      }),
    )
    .max(40),
});
export type CoordinatorPlan = z.infer<typeof CoordinatorPlanSchema>;
export type CoordinatorAction = CoordinatorPlan["actions"][number];

export const COORDINATOR_SYSTEM = [
  "You are the coordinator of a radiology drafting service. You see only a de-identified queue: study ids, stages, priorities, ages, reading SLAs and flags.",
  "You never see images or clinical text and never make clinical judgements. Plan the queue with three actions:",
  "- plan_study: for a study in stage ready or clinician_review whose lastAction is none. Set lane (routine, urgent or critical; never below its priority) and radiologistRead (true for urgent or critical, or when degraded).",
  "- requeue_study: for a study whose lastAction is failed:model_unavailable or failed:timeout and that has not been requeued.",
  "- escalate_to_human: when slaMinutesLeft is negative (it is null while a radiologist read is in hand), lastAction is stalled, needsRetake is set, or a failure cannot be retried. Skip studies already escalated, and studies in clinician_review unless needsRetake is set (a clinician is reading them).",
  "Return only actions that are needed; an empty list is fine. Each reason is one short sentence about the queue.",
].join("\n");

const RANK: Record<Lane, number> = { routine: 0, urgent: 1, critical: 2 };
const TRANSIENT = new Set(["failed:model_unavailable", "failed:timeout"]);

/** Keeps the safe subset of a plan, one action per study and kind. */
export function validatePlan(plan: CoordinatorPlan, queue: QueueItem[]): CoordinatorAction[] {
  const byId = new Map(queue.map((q) => [q.studyId, q]));
  const seen = new Set<string>();
  const out: CoordinatorAction[] = [];
  for (const a of plan.actions) {
    const item = byId.get(a.studyId);
    const key = `${a.action}:${a.studyId}`;
    if (!item || seen.has(key)) continue;
    if (a.action === "plan_study") {
      if (!(item.stage === "ready" || item.stage === "clinician_review") || item.lastAction !== "none") continue;
      const floor = item.priority ?? "routine";
      const lane = a.lane && RANK[a.lane] >= RANK[floor] ? a.lane : floor;
      out.push({ ...a, lane });
    } else if (a.action === "requeue_study") {
      if (!TRANSIENT.has(item.lastAction)) continue;
      out.push(a);
    } else {
      // Someone has the case open: only a retake interrupts the review.
      if (item.lastAction === "escalated" || (item.stage === "clinician_review" && !item.flags.needsRetake)) continue;
      out.push(a);
    }
    seen.add(key);
  }
  return out;
}

/** The same three actions in plain code: the fallback when Wonder is unavailable, and the SLA sweep. */
export function rulePlan(queue: QueueItem[]): CoordinatorAction[] {
  const out: CoordinatorAction[] = [];
  for (const q of queue) {
    if (q.lastAction === "escalated") continue;
    if ((q.stage === "ready" || q.stage === "clinician_review") && q.lastAction === "none") {
      const lane = q.priority ?? "routine";
      out.push({ action: "plan_study", studyId: q.studyId, lane, radiologistRead: lane !== "routine" || q.flags.degraded, reason: `Draft ready; ${lane} lane.` });
    }
    const escalation = slaEscalation(q);
    if (escalation) out.push(escalation);
    else if (TRANSIENT.has(q.lastAction)) out.push({ action: "requeue_study", studyId: q.studyId, reason: "The model service failed; one more try now that it may be up." });
  }
  return out;
}

/**
 * The SLA sweep: overdue reads, stalled runs, retakes and failures that
 * can't be retried go to a human. Applied every tick, whatever Wonder says.
 */
export function slaEscalation(q: QueueItem): CoordinatorAction | null {
  if (q.lastAction === "escalated") return null;
  if (q.slaMinutesLeft !== null && q.slaMinutesLeft < 0 && q.stage !== "failed") {
    return { action: "escalate_to_human", studyId: q.studyId, reason: `${q.priority ?? "Priority"} read is ${-q.slaMinutesLeft} min past its SLA.` };
  }
  if (q.lastAction === "stalled") return { action: "escalate_to_human", studyId: q.studyId, reason: "Analysis has made no progress for 20 minutes." };
  if (q.flags.needsRetake && q.stage !== "failed") return { action: "escalate_to_human", studyId: q.studyId, reason: "The image needs a retake." };
  if (q.lastAction.startsWith("failed:") && !TRANSIENT.has(q.lastAction)) return { action: "escalate_to_human", studyId: q.studyId, reason: `Analysis stopped (${q.lastAction.slice(7)}) and cannot be retried automatically.` };
  return null;
}
