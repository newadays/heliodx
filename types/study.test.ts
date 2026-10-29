import { describe, expect, it } from "vitest";

import { isDraftReady, isTerminalStatus, STUDY_STATUSES } from "./study";

describe("study status helpers", () => {
  it("treats ready and every later stage as draft-ready", () => {
    const expected = ["ready", "clinician_review", "signed", "patient_summary_ready", "shared", "closed"];
    expect(STUDY_STATUSES.filter(isDraftReady)).toEqual(expected);
  });

  it("stops the analyzing watchdog for failed and draft-ready studies only", () => {
    expect(STUDY_STATUSES.filter(isTerminalStatus)).toEqual([
      "ready", "failed", "clinician_review", "signed", "patient_summary_ready", "shared", "closed",
    ]);
  });
});
