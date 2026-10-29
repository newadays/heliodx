/**
 * The patient note's check against the signed report (B24 chip): each next
 * step may say only what its signed Recommendation sentence says, and the
 * body may name no condition the signed Impression doesn't. Same rules as
 * the backend's share gate (functions/src/lib/patientSummary.ts), run here so
 * the chip updates as the clinician edits.
 */
import { bodyConditionViolations, conditionViolations, newInstructionTerms, recommendationSentences } from "@/functions/src/lib/patientSummary";
import type { PatientSummary, SignedReport } from "@/types/study";

export type NoteCheck = { status: "ok" } | { status: "unsupported"; sentences: number; steps: number[] } | { status: "pending" };

export function checkNote(note: Pick<PatientSummary, "body" | "nextSteps"> | null, report: SignedReport | undefined): NoteCheck {
  if (!note || !report) return { status: "pending" };
  const signed = recommendationSentences(report.summary?.recommendation ?? "");
  const steps: number[] = [];
  note.nextSteps.forEach((s, i) => {
    if (s.fromSignedText) return;
    const source = signed[s.mapsTo] ?? "";
    if (newInstructionTerms(source, s.text).length || conditionViolations(s.text, report.summary?.impression ?? [], source).length) steps.push(i + 1);
  });
  const body = bodyConditionViolations(note.body, report.summary?.impression ?? []).length;
  const sentences = steps.length + body;
  return sentences ? { status: "unsupported", sentences, steps } : { status: "ok" };
}
