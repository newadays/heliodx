import { describe, expect, it } from "vitest";

import { canRetry } from "../src/callables/retryPipeline";
import {
  assertTransition,
  canTransition,
  predecessorsOf,
  STUDY_STATUSES,
  WrongStateError,
  type StudyStatus,
} from "../src/study/stateMachine";

/** The full table, written out so any change to the machine is deliberate. */
const LEGAL: Record<StudyStatus, StudyStatus[]> = {
  uploading: ["queued", "quality_check", "failed"],
  queued: ["queued", "quality_check", "failed"],
  quality_check: ["classifying", "queued", "failed"],
  classifying: ["detecting", "queued", "failed"],
  detecting: ["summarizing", "queued", "failed"],
  summarizing: ["ready", "queued", "failed"],
  failed: ["queued"],
  ready: ["clinician_review", "signed", "closed"],
  clinician_review: ["signed", "closed"],
  signed: ["patient_summary_ready", "closed"],
  patient_summary_ready: ["shared", "closed"],
  shared: ["shared", "closed"],
  closed: [],
};

describe("study state machine", () => {
  for (const from of STUDY_STATUSES) {
    for (const to of STUDY_STATUSES) {
      const legal = LEGAL[from].includes(to);
      it(`${from} → ${to} is ${legal ? "allowed" : "refused"}`, () => {
        expect(canTransition(from, to)).toBe(legal);
        if (legal) expect(() => assertTransition(from, to)).not.toThrow();
        else expect(() => assertTransition(from, to)).toThrow(WrongStateError);
      });
    }
  }

  it("never lets a signed or later study go back to a draft", () => {
    for (const from of ["signed", "patient_summary_ready", "shared", "closed"] as const) {
      for (const to of ["ready", "clinician_review", "queued", "quality_check", "detecting"] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("reports what a refused move needs", () => {
    try {
      assertTransition("ready", "shared");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WrongStateError);
      expect((e as WrongStateError).stage).toBe("ready");
      expect((e as WrongStateError).needs).toEqual(["status patient_summary_ready", "status shared"]);
    }
    expect(predecessorsOf("signed")).toEqual(["ready", "clinician_review"]);
  });

  it("does not offer a retry on a signed or shared study", () => {
    const now = 1_000_000_000;
    for (const s of ["signed", "patient_summary_ready", "shared", "closed", "clinician_review"]) {
      expect(canRetry(s, now - 10 * 60_000, now)).toEqual({ ok: false, reason: "already_ready" });
    }
  });
});
