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
import { MODEL_MOCK } from "../config";
import { gpuHealth, type ServiceState } from "../models/gpu";
import { reviewHash } from "./reviewHash";
import { traceScope } from "./trace";

export const DRAFT_DEBOUNCE_MS = 600;
/** A cold GPU takes about 5 minutes to start; wait up to 6 before giving up. */
export const GPU_WAIT_MS = 6 * 60 * 1000;
export const GPU_POLL_MS = 10_000;

type DraftStudy = StudyDoc & {
  reviewHash?: string | null;
  clinicianSummary?: { editedByClinician?: boolean; generatedFromReviewHash?: string | null } | null;
  reportDraft?: { forHash?: string | null; requestedAt?: { toMillis(): number } | Date | null };
};

function millis(v: { toMillis(): number } | Date | null | undefined): number | null {
  if (!v) return null;
  return v instanceof Date ? v.getTime() : v.toMillis();
}

/** Whether this change needs a new draft: decisions changed, report not edited, still in review. */
export function needsDraft(before: DraftStudy | undefined, after: DraftStudy | undefined): boolean {
  if (!after || after.status !== "ready") return false;
  if (after.clinicianSummary?.editedByClinician) return false;
  // Asked for explicitly (Sign step, "Update now" on a cold GPU): draft if
  // the report is behind the decisions, finished review or not.
  const asked = millis(after.reportDraft?.requestedAt);
  if (asked !== null && asked !== millis(before?.reportDraft?.requestedAt)) {
    return !!after.reviewHash && after.clinicianSummary?.generatedFromReviewHash !== after.reviewHash;
  }
  // One draft per finished review, not one per click: wait until every
  // finding has a decision (the Sign step asks for a draft itself when the
  // clinician continues with some left undecided).
  if ((after.findings ?? []).some((f) => (f as { status?: string }).status === "pending")) return false;
  if (!after.reviewHash || after.reviewHash === before?.reviewHash) return false;
  return after.clinicianSummary?.generatedFromReviewHash !== after.reviewHash;
}

export interface DraftDeps {
  sleep?: (ms: number) => Promise<void>;
  draft?: typeof draftClinicianSummary;
  /** Glimmer's state on the private GPU; skipped with mock models. */
  health?: () => Promise<{ glimmer: ServiceState }>;
  now?: () => number;
}

/** Returns what happened, for logs and tests. */
export async function draftReport(db: Firestore, ref: DocumentReference, deps: DraftDeps = {}): Promise<"drafted" | "superseded" | "skipped" | "gpu_unavailable"> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const draft = deps.draft ?? draftClinicianSummary;
  const health = deps.health ?? (MODEL_MOCK ? null : () => gpuHealth(8_000));
  const now = deps.now ?? Date.now;
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

  // A cold GPU (scaled to zero while the clinician reviewed): wait for it
  // here, with `reportDraft.warming` set so the Sign step can say so, instead
  // of a 90 s model timeout and a draft that never lands.
  const state = health ? (await health()).glimmer : "ok";
  // "not_configured" (no GPU_URL, e.g. tests) has nothing to wait for.
  if (health && state !== "ok" && state !== "not_configured") {
    const since = now();
    await ref.update({ "reportDraft.warming": true, "reportDraft.warmingSince": new Date(since) });
    let ready = false;
    while (!ready && now() - since < GPU_WAIT_MS) {
      await sleep(GPU_POLL_MS);
      ready = (await health()).glimmer === "ok";
    }
    if (!ready) {
      await ref.update({ reportDraft: { forHash: null, failedAt: new Date(), reason: "gpu_starting" } }).catch(() => undefined);
      return "gpu_unavailable";
    }
    await ref.update({ "reportDraft.warming": false, "reportDraft.gpuWaitMs": now() - since });
  }

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
