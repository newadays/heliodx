import { describe, expect, it } from "vitest";

import {
  BLURRED,
  gradeError,
  gradeIntake,
  gradeNote,
  gradePrep,
  gradeTriage,
  intakeCriteria,
  noteCriteria,
  NOT_MEDICAL,
  prepCriteria,
  scoreOf,
  triageCriteria,
  type IntakeOutcome,
  type NoteOutcome,
  type PrepOutcome,
  type TriageOutcome,
} from "../src/eval/grade";
import type { EvalTask } from "../src/eval/types";

const task = (over: Partial<EvalTask>): EvalTask => ({
  id: "t",
  title: "t",
  family: "intake",
  tags: [],
  split: "held-out",
  film: null,
  context: { age: null, sex: null, indication: "", synthetic: true },
  expected: {},
  criteria: [],
  ...over,
});

const byId = (rs: { id: string; pass: boolean | null }[]) => Object.fromEntries(rs.map((r) => [r.id, r.pass]));

describe("intake grading", () => {
  const clean: IntakeOutcome = { retake: false, issues: [], warnings: [], modality: "xray", view: "PA", chest: true };

  it("passes a clean film that is accepted, read as a PA X-ray with both lungs", () => {
    const t = task({ variant: "clean", criteria: intakeCriteria("clean") });
    expect(byId(gradeIntake(t, clean))).toEqual({ no_retake: true, modality: true, view: true, chest: true });
    expect(byId(gradeIntake(t, { ...clean, view: "AP", chest: false }))).toMatchObject({ view: false, chest: false });
  });

  it("needs the right blocking reason on built variants", () => {
    const blur = task({ variant: "blur", criteria: intakeCriteria("blur") });
    expect(byId(gradeIntake(blur, { ...clean, retake: true, issues: [BLURRED] }))).toEqual({ retake: true, reason: true });
    expect(byId(gradeIntake(blur, clean))).toEqual({ retake: false, reason: false });
    const photo = task({ variant: "nonmedical", criteria: intakeCriteria("nonmedical") });
    expect(byId(gradeIntake(photo, { ...clean, retake: true, issues: [NOT_MEDICAL] }))).toEqual({ retake: true, not_medical: true });
  });
});

describe("triage grading", () => {
  const out: TriageOutcome = { priority: "urgent", floor: "routine", cited: ["cardiothoracic_ratio"], allowed: ["cardiothoracic_ratio", "lung_l"], needsHuman: false, flags: [], rationale: "" };

  it("counts a lane at or above the label as a pass, except that normal films must stay routine", () => {
    expect(byId(gradeTriage(task({ expected: { lane: "urgent" }, criteria: triageCriteria("urgent") }), out)).lane).toBe(true);
    expect(byId(gradeTriage(task({ expected: { lane: "critical" }, criteria: triageCriteria("critical") }), out)).lane).toBe(false);
    expect(byId(gradeTriage(task({ expected: { lane: "routine" }, criteria: triageCriteria("routine") }), out)).lane).toBe(false);
  });

  it("fails evidence the film does not have, and a fallback to a human", () => {
    const t = task({ expected: { lane: "urgent" }, criteria: triageCriteria("urgent") });
    expect(byId(gradeTriage(t, { ...out, cited: ["heart_size"] })).evidence).toBe(false);
    expect(byId(gradeTriage(t, { ...out, needsHuman: true }))).toMatchObject({ answered: false, evidence: false });
  });
});

describe("prep grading", () => {
  const finding = (ids: string[]) => ({ title: "Heart size", description: "d", evidence: { measurementIds: ids, maskIds: [] } });
  const out: PrepOutcome = { findings: [finding(["cardiothoracic_ratio"])], flagged: ["cardiothoracic_ratio"], dropped: { conditions: 0, noEvidence: 0 }, proposed: 1, impression: ["x"], impressionFallback: false, recommendation: "" };

  it("grades what the model proposed before the filters, and polarity against the label", () => {
    const abnormal = task({ family: "prep", expected: { polarity: "attention" }, criteria: prepCriteria("attention") });
    expect(Object.values(byId(gradePrep(abnormal, out))).every(Boolean)).toBe(true);
    const r = byId(gradePrep(abnormal, { ...out, flagged: [], dropped: { conditions: 1, noEvidence: 2 }, impressionFallback: true }));
    expect(r).toMatchObject({ no_condition: false, no_uncited: false, polarity: false, impression: false });
    const normal = task({ family: "prep", expected: { polarity: "normal" }, criteria: prepCriteria("normal") });
    expect(byId(gradePrep(normal, out)).polarity).toBe(false);
  });
});

describe("patient note grading", () => {
  const out: NoteOutcome = {
    sentences: ["Correlate clinically."],
    impression: ["No acute abnormality."],
    first: { body: "Your doctor looked at your chest picture.", nextSteps: ["Talk with your doctor about how you feel."] },
    firstGrade: 4,
    firstOk: true,
    attempts: 1,
    flagged: 0,
    readingGrade: 4,
  };

  it("passes a faithful plain rewrite and fails added terms, conditions and missing steps", () => {
    const t = task({ family: "note", criteria: noteCriteria() });
    expect(Object.values(byId(gradeNote(t, out))).every(Boolean)).toBe(true);
    const bad = byId(gradeNote(t, { ...out, first: { body: "You may have pneumonia.", nextSteps: [] }, firstOk: false, firstGrade: 11 }));
    expect(bad).toMatchObject({ steps: false, no_condition: false, grade: false, first_try: false });
    expect(byId(gradeNote(t, { ...out, first: { ...out.first, nextSteps: ["Take 500 mg twice a day."] } })).no_added).toBe(false);
  });
});

describe("scores", () => {
  it("is the share of criteria passed, and a crash scores zero", () => {
    const t = task({ criteria: intakeCriteria("blur") });
    const results = gradeError(t, "boom");
    expect(results.every((r) => r.pass === false)).toBe(true);
    expect(scoreOf(results)).toBe(0);
    expect(scoreOf([{ ...results[0], pass: true }, results[1]])).toBe(0.5);
  });
});
