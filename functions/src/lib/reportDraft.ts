/**
 * B23 · Background drafting of the clinician report: once every finding has
 * a decision, and whenever the decisions change after that, the report is
 * redrafted from them (debounced), so the Sign step shows a draft that matches
 * the decisions instead of waiting. One GPU call per finished review rather
 * than one per click.
 * A draft is written only if the decisions are still the ones it was made
 * from; a newer change triggers its own draft. Edited reports are left alone.
 */
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

import { draftClinicianSummary, type StudyDoc } from "../callables/regenerateSummaries";
import { reviewHash } from "./reviewHash";
import { traceScope } from "./trace";

export const DRAFT_DEBOUNCE_MS = 600;

type DraftStudy = StudyDoc & { reviewHash?: string | null; clinicianSummary?: { editedByClinician?: boolean; generatedFromReviewHash?: string | null } | null; reportDraft?: { forHash?: string } };

/** Whether this change needs a new draft: decisions changed, report not edited, still in review. */
export function needsDraft(before: DraftStudy | undefined, after: DraftStudy | undefined): boolean {
  if (!after || after.status !== "ready") return false;
  // One draft per finished review, not one per click: wait until every
  // finding has a decision (the Sign step asks for a draft itself when the
  // clinician continues with some left undecided).
  if ((after.findings ?? []).some((f) => (f as { status?: string }).status === "pending")) return false;
  if (!after.reviewHash || after.reviewHash === before?.reviewHash) return false;
  if (after.clinicianSummary?.editedByClinician) return false;
  return after.clinicianSummary?.generatedFromReviewHash !== after.reviewHash;
}

export interface DraftDeps {
  sleep?: (ms: number) => Promise<void>;
  draft?: typeof draftClinicianSummary;
}

/** Returns what happened, for logs and tests. */
export async function draftReport(db: Firestore, ref: DocumentReference, deps: DraftDeps = {}): Promise<"drafted" | "superseded" | "skipped"> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const draft = deps.draft ?? draftClinicianSummary;
  await sleep(DRAFT_DEBOUNCE_MS);

  // Claim: one draft per decision set.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const study = snap.data() as DraftStudy | undefined;
    if (!study || !needsDraft(undefined, study)) return null;
    const hash = reviewHash(study.findings ?? []);
    if (hash !== study.reviewHash || study.reportDraft?.forHash === hash) return null;
    tx.update(ref, { reportDraft: { forHash: hash, startedAt: new Date() } });
    return { study, hash };
  });
  if (!claimed) return "skipped";

  let clinicianSummary;
  try {
    ({ clinicianSummary } = await traceScope(ref, "summarizing", () => draft(claimed.study)));
  } catch (error) {
    // Release the claim so the next change (or the app's "Update report") can try again.
    await ref.update({ reportDraft: { forHash: null, failedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = snap.data() as DraftStudy | undefined;
    if (!now || now.status !== "ready" || now.reviewHash !== claimed.hash || now.clinicianSummary?.editedByClinician) return "superseded";
    tx.update(ref, { clinicianSummary, "reportDraft.doneAt": new Date() });
    return "drafted";
  });
}
