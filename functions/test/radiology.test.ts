import { describe, expect, it } from "vitest";

import { signNeeds } from "../src/lib/report";
import { queueItem, type CoordinatorStudy } from "../src/coordinator/snapshot";
import { readNeed, readRequirement } from "../src/radiology/gate";
import { readStep } from "../src/radiology/reads";
import { DEFAULT_ROSTER, NUDGE_GRACE_MS, pickReader, rosterOf } from "../src/radiology/roster";

const t = (ms: number) => ({ toMillis: () => ms });
const NOW = 1_800_000_000_000;
const min = 60_000;

describe("read gate", () => {
  it("requires a read for critical, a human flag, an accepted weak finding or a request; in that order", () => {
    expect(readRequirement({ priority: "critical", flags: { needsHuman: true } })).toEqual({ reason: "critical" });
    expect(readRequirement({ priority: "urgent", flags: { needsHuman: true } })).toEqual({ reason: "needs_human" });
    expect(readRequirement({ findings: [{ status: "edited", strength: "weak" }] })).toEqual({ reason: "weak_finding" });
    expect(readRequirement({ radiologistRead: { requestedBy: "u1" } })).toEqual({ reason: "requested" });
    // A weak finding the clinician rejected or hasn't decided doesn't count.
    expect(readRequirement({ priority: "routine", findings: [{ status: "rejected", strength: "weak" }, { status: "pending", strength: "weak" }] })).toBeNull();
  });

  it("asks to request a read, then waits for it, then lets the clinician sign", () => {
    expect(readNeed({ priority: "critical" })).toBe("request");
    expect(readNeed({ priority: "critical", radiologistRead: { status: "assigned" } })).toBe("close");
    expect(readNeed({ priority: "critical", radiologistRead: { status: "signed" } })).toBeNull();
    expect(readNeed({ priority: "routine" })).toBeNull();
    const ready = { findings: [], clinicianSummary: { impression: ["x"], recommendation: "y", editedByClinician: true } };
    expect(signNeeds({ ...ready, priority: "critical" })).toEqual(["request_radiologist_read"]);
    expect(signNeeds({ ...ready, priority: "critical", radiologistRead: { required: true, status: "assigned" } })).toEqual(["close_radiologist_read"]);
    expect(signNeeds({ ...ready, priority: "critical", radiologistRead: { required: true, status: "signed" } })).toEqual([]);
  });
});

describe("simulated readers", () => {
  it("sends critical cases to the fast reader and rotates the rest stably", () => {
    expect(pickReader(DEFAULT_ROSTER, { id: "x", priority: "critical" }).profile).toBe("fast");
    const a = pickReader(DEFAULT_ROSTER, { id: "study-a", priority: "urgent" });
    expect(pickReader(DEFAULT_ROSTER, { id: "study-a", priority: "urgent" })).toEqual(a);
    const profiles = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((id) => pickReader(DEFAULT_ROSTER, { id }).profile));
    expect(profiles.size).toBe(3);
    expect(rosterOf({ radiologists: [{ id: "u", name: "Dr. X", profile: "slow" }, { bad: 1 }] })).toEqual([{ id: "u", name: "Dr. X", profile: "slow", simulated: true }]);
    expect(rosterOf({})).toBe(DEFAULT_ROSTER);
  });

  it("signs fast and slow reads at their ETA; nudges a silent one, then reassigns it", () => {
    expect(readStep({ status: "assigned", profile: "fast", eta: t(NOW) }, NOW - 1)).toBeNull();
    expect(readStep({ status: "assigned", profile: "slow", eta: t(NOW) }, NOW)).toBe("sign");
    expect(readStep({ status: "assigned", profile: "silent", eta: t(NOW) }, NOW)).toBe("nudge");
    expect(readStep({ status: "assigned", profile: "silent", eta: t(NOW), nudgedAt: t(NOW) }, NOW + NUDGE_GRACE_MS - 1)).toBeNull();
    expect(readStep({ status: "assigned", profile: "silent", eta: t(NOW), nudgedAt: t(NOW) }, NOW + NUDGE_GRACE_MS)).toBe("reassign");
    expect(readStep({ status: "signed", profile: "fast", eta: t(NOW) }, NOW)).toBeNull();
  });
});

describe("SLA with a read", () => {
  const base = (over: Partial<CoordinatorStudy>): CoordinatorStudy => ({ id: "a", status: "ready", priority: "critical", createdAt: t(NOW - 30 * min), updatedAt: t(NOW), flags: {}, pipeline: { stepTimestamps: { detecting: t(NOW - 20 * min) } }, ...over });

  it("stops the clock while the first reader has it and once it is signed; runs from a reassignment", () => {
    expect(queueItem(base({}), NOW).slaMinutesLeft).toBe(-15);
    expect(queueItem(base({ radiologistRead: { status: "assigned", assignedAt: t(NOW - 10 * min) } }), NOW).slaMinutesLeft).toBeNull();
    expect(queueItem(base({ radiologistRead: { status: "signed", assignedAt: t(NOW - 10 * min) } }), NOW).slaMinutesLeft).toBeNull();
    expect(queueItem(base({ radiologistRead: { status: "assigned", assignedAt: t(NOW - 7 * min), reassignedFrom: "Dr. H. Danjuma" } }), NOW).slaMinutesLeft).toBe(-2);
  });
});
