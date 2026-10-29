/**
 * Patient summary helpers (cards B16/F8). Pure, so the confirmation and edit
 * rules are unit-tested. Studies written before B16 stored "what happens
 * next" as one string; `normalizePatientSummary` turns that into one
 * unconfirmed step so old studies still render and still need confirming.
 */
import type { NextStep, PatientSummary } from "@/types/study";

type RawSummary = Omit<PatientSummary, "nextSteps"> & { nextSteps?: NextStep[] | string | null };

export function normalizePatientSummary(raw: RawSummary | null | undefined): PatientSummary | null {
  if (!raw) return null;
  const steps: NextStep[] = Array.isArray(raw.nextSteps)
    ? raw.nextSteps.map((s, i) => ({ ...s, text: s.text ?? "", mapsTo: s.mapsTo ?? i, confirmed: s.confirmed === true }))
    : typeof raw.nextSteps === "string" && raw.nextSteps.trim()
      ? [{ text: raw.nextSteps.trim(), mapsTo: 0, confirmed: false }]
      : [];
  return { ...raw, nextSteps: steps };
}

/** Sharing needs a summary whose every step the clinician has confirmed. */
export function allStepsConfirmed(summary: PatientSummary | null): boolean {
  return !!summary && summary.nextSteps.every((s) => s.confirmed);
}

export function unconfirmedCount(summary: PatientSummary | null): number {
  return summary ? summary.nextSteps.filter((s) => !s.confirmed).length : 0;
}

export function withStepConfirmed(summary: PatientSummary, index: number, confirmed: boolean): PatientSummary {
  return {
    ...summary,
    nextSteps: summary.nextSteps.map((s, i) => (i === index ? { ...s, confirmed } : s)),
  };
}

/**
 * The clinician's edits. A step whose text changed must be confirmed again
 * and is no longer "taken word for word"; unchanged steps keep their state.
 */
export function withEdits(summary: PatientSummary, edit: { title: string; body: string; steps: string[] }): PatientSummary {
  return {
    ...summary,
    title: edit.title.trim(),
    body: edit.body.trim(),
    nextSteps: summary.nextSteps.map((s, i) => {
      const text = (edit.steps[i] ?? s.text).trim();
      if (text === s.text) return s;
      const { fromSignedText: _dropped, ...rest } = s;
      return { ...rest, text, confirmed: false };
    }),
    editedByClinician: true,
  };
}

/** "What happens next" as plain lines, for the share message and PDF. */
export function nextStepLines(summary: Pick<PatientSummary, "nextSteps">): string[] {
  return summary.nextSteps.map((s) => s.text.trim()).filter(Boolean);
}

/** "Reviewed and approved by …", falling back for summaries written before B16. */
export function attributionLine(summary: Pick<PatientSummary, "attribution" | "reviewedBy">): string {
  return summary.attribution?.trim() || `Reviewed by ${summary.reviewedBy.trim()}`;
}
