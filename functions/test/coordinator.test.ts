import { describe, expect, it, vi } from "vitest";

import { COORDINATOR_SYSTEM, rulePlan, slaEscalation, validatePlan } from "../src/coordinator/plan";
import { needsDecision, queueItem, queueSnapshot, type CoordinatorStudy } from "../src/coordinator/snapshot";
import { generateJson } from "../src/models/client";
import { assertPayloadAllowed } from "../src/models/routes";
import { CoordinatorPlanSchema } from "../src/coordinator/plan";

const NOW = 1_800_000_000_000;
const t = (ms: number) => ({ toMillis: () => ms });
const min = 60_000;

function s(id: string, over: Partial<CoordinatorStudy> = {}): CoordinatorStudy {
  return { id, status: "ready", priority: "routine", createdAt: t(NOW - 10 * min), updatedAt: t(NOW - min), flags: {}, pipeline: { stepTimestamps: {} }, ...over };
}

describe("queue snapshot", () => {
  it("carries only de-identified queue state, accepted by the coordination route guard", () => {
    const study = { ...s("a"), patient: { name: "Jane Doe" }, clinicalContext: "cough", findings: [{ title: "x" }], orgId: "demo" } as CoordinatorStudy;
    const snap = queueSnapshot([study], NOW);
    expect(() => assertPayloadAllowed("coordination", { context: snap })).not.toThrow();
    expect(JSON.stringify(snap)).not.toMatch(/Jane|cough|demo|title/);
    expect(snap.queue[0]).toEqual({ studyId: "a", stage: "ready", priority: "routine", ageMinutes: 10, slaMinutesLeft: null, flags: { needsRetake: false, degraded: false, needsHuman: false }, lastAction: "none" });
  });

  it("computes the SLA from the detecting timestamp, and marks stalled and failed studies", () => {
    const urgent = queueItem(s("u", { priority: "urgent", pipeline: { stepTimestamps: { detecting: t(NOW - 34 * min) } } }), NOW);
    expect(urgent.slaMinutesLeft).toBe(-4);
    expect(queueItem(s("st", { status: "detecting", updatedAt: t(NOW - 25 * min) }), NOW).lastAction).toBe("stalled");
    expect(queueItem(s("f", { status: "failed", pipeline: { error: { code: "timeout" } } }), NOW).lastAction).toBe("failed:timeout");
    expect(queueItem(s("f2", { status: "failed", pipeline: { error: { code: "timeout" } }, coordinator: { requeues: 1 } }), NOW).lastAction).toBe("failed:exhausted");
  });

  it("asks for a decision only when there is one to make", () => {
    expect(needsDecision(queueItem(s("ready"), NOW))).toBe(true);
    expect(needsDecision(queueItem(s("planned", { coordinator: { plannedAt: new Date() } }), NOW))).toBe(false);
    expect(needsDecision(queueItem(s("running", { status: "detecting" }), NOW))).toBe(false);
    expect(needsDecision(queueItem(s("esc", { status: "failed", coordinator: { escalation: {} } }), NOW))).toBe(false);
  });
});

describe("validatePlan", () => {
  const queue = queueSnapshot(
    [s("r", { priority: "urgent" }), s("f", { status: "failed", pipeline: { error: { code: "model_unavailable" } } }), s("q", { status: "failed", pipeline: { error: { code: "quality_rejected" } } }), s("e", { coordinator: { escalation: {} } })],
    NOW,
  ).queue;

  it("never lowers a lane, ignores unknown studies, illegal requeues, repeats and escalated studies", () => {
    const out = validatePlan(
      {
        actions: [
          { action: "plan_study", studyId: "r", lane: "routine", radiologistRead: true, reason: "x" },
          { action: "plan_study", studyId: "r", lane: "critical", reason: "dup" },
          { action: "plan_study", studyId: "nope", lane: "urgent", reason: "x" },
          { action: "requeue_study", studyId: "q", reason: "x" },
          { action: "requeue_study", studyId: "f", reason: "x" },
          { action: "escalate_to_human", studyId: "e", reason: "x" },
        ],
      },
      queue,
    );
    expect(out).toEqual([
      { action: "plan_study", studyId: "r", lane: "urgent", radiologistRead: true, reason: "x" },
      { action: "requeue_study", studyId: "f", reason: "x" },
    ]);
  });
});

describe("rules fallback and SLA sweep", () => {
  it("plans ready studies, requeues transient failures once and escalates overdue, stalled, retake and unretryable cases", () => {
    const queue = queueSnapshot(
      [
        s("ready", { priority: "urgent", pipeline: { stepTimestamps: { detecting: t(NOW - 5 * min) } } }),
        s("overdue", { priority: "critical", coordinator: { plannedAt: new Date() }, pipeline: { stepTimestamps: { detecting: t(NOW - 9 * min) } } }),
        s("timeout", { status: "failed", pipeline: { error: { code: "timeout" } } }),
        s("again", { status: "failed", pipeline: { error: { code: "timeout" } }, coordinator: { requeues: 1 } }),
        s("stalled", { status: "classifying", updatedAt: t(NOW - 30 * min) }),
        s("retake", { status: "ready", coordinator: { plannedAt: new Date() }, flags: { needsRetake: true } }),
      ],
      NOW,
    ).queue;
    const plan = rulePlan(queue).map((a) => `${a.action}:${a.studyId}${a.lane ? `:${a.lane}:${a.radiologistRead}` : ""}`);
    expect(plan).toEqual([
      "plan_study:ready:urgent:true",
      "escalate_to_human:overdue",
      "requeue_study:timeout",
      "escalate_to_human:again",
      "escalate_to_human:stalled",
      "escalate_to_human:retake",
    ]);
    expect(slaEscalation(queue[1])?.reason).toBe("critical read is 4 min past its SLA.");
  });
});

describe("Wonder call", () => {
  it("sends the coordinator prompt and the queue only, on the hosted route", async () => {
    const queue = queueSnapshot([s("a")], NOW).queue;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ actions: [] }) } }] }), { status: 200 }),
    );
    try {
      const out = await generateJson({ route: "coordination", schema: CoordinatorPlanSchema, system: COORDINATOR_SYSTEM, prompt: "Plan this queue.", context: { queue }, step: "queued" });
      expect(out).toEqual({ actions: [] });
      const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(body.model).toBe("muse-wonder-1.0");
      expect(body.messages[0].content).toBe(COORDINATOR_SYSTEM);
      expect(body.messages[1].content[0].text).toContain('"studyId":"a"');
      expect(JSON.stringify(body)).not.toMatch(/image_url/);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
