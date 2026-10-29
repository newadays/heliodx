/**
 * StudyWriter: the only way server code changes a study.
 *
 * Every write runs in a Firestore transaction that re-reads the study first,
 * so it is checked against the current state, not a stale copy:
 *  - status changes must be legal (`stateMachine.ts`);
 *  - a writer bound to a pipeline run refuses to write once another run has
 *    claimed the study, so a late or duplicate run can never move a study
 *    backwards or overwrite a newer draft.
 *
 * Status changes and named actions also append an entry to
 * `studies/{id}/audit`. Audit entries carry ids, statuses and codes only:
 * never clinical text, patient details or model output.
 */
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from "firebase-admin/firestore";

import type { PipelineErrorCode } from "../pipeline/errors";
import { nextStep } from "../pipeline/retryPolicy";
import { assertTransition, isStudyStatus, WrongStateError, type StudyFlags, type StudyStatus } from "./stateMachine";

/** Who caused a write: the pipeline, a scheduled job, or a signed-in user. */
export type Actor = "pipeline" | "scheduler" | "coordinator" | { uid: string };

export interface AuditEntry {
  at: FieldValue;
  actor: string;
  action: string;
  from: StudyStatus | null;
  to: StudyStatus | null;
  runId?: string;
  code?: string;
  /** Decision details for the record (ids, flags, hashes); never clinical text or contact details. */
  detail?: Record<string, unknown>;
}

interface StudySnapshot {
  status: StudyStatus;
  runId: string | null;
  /** Transient failures so far (see `pipeline/retryPolicy.ts`). */
  attempts: number;
}

export class StudyWriter {
  constructor(
    private readonly ref: DocumentReference,
    private readonly actor: Actor,
    /** Set for pipeline runs; writes are refused once another run owns the study. */
    private readonly runId?: string,
  ) {}

  /**
   * Claim the study for this run and move it to `quality_check`, atomically.
   * Two events racing for the same study: exactly one wins.
   */
  async claim(): Promise<{ started: boolean; reason: string }> {
    if (!this.runId) throw new Error("claim() needs a runId.");
    return this.ref.firestore.runTransaction(async (tx) => {
      const study = await this.read(tx);
      if (study.runId === this.runId) return { started: false, reason: "duplicate_event" };
      if (study.status !== "uploading" && study.status !== "queued") {
        return { started: false, reason: `status_${study.status}` };
      }
      assertTransition(study.status, "quality_check");
      tx.update(this.ref, {
        status: "quality_check",
        "pipeline.runId": this.runId,
        "pipeline.startedAt": Timestamp.now(),
        "pipeline.error": FieldValue.delete(),
        "pipeline.stepTimestamps.quality_check": Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, { action: "pipeline_started", from: study.status, to: "quality_check" });
      return { started: true, reason: "ok" };
    });
  }

  /** Legal status change plus any fields that belong with it. */
  async advance(to: StudyStatus, fields: Record<string, unknown> = {}, opts: { action?: string; code?: string } = {}): Promise<StudyStatus> {
    return this.ref.firestore.runTransaction(async (tx) => {
      const study = await this.read(tx);
      this.assertOwnRun(study);
      assertTransition(study.status, to);
      tx.update(this.ref, {
        ...fields,
        status: to,
        [`pipeline.stepTimestamps.${to}`]: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, { action: opts.action ?? "status_changed", from: study.status, to, code: opts.code });
      return study.status;
    });
  }

  /**
   * A legal status change whose fields are computed from the study as read
   * inside the transaction, so checks and writes see the same data. `compute`
   * may throw (e.g. WrongStateError) to abort without writing.
   */
  async advanceWith(
    to: StudyStatus,
    compute: (data: FirebaseFirestore.DocumentData) => Record<string, unknown>,
    opts: { action: string },
  ): Promise<Record<string, unknown>> {
    return this.ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      const study = await this.read(tx);
      this.assertOwnRun(study);
      assertTransition(study.status, to);
      const fields = compute(snap.data() ?? {});
      tx.update(this.ref, {
        ...fields,
        status: to,
        [`pipeline.stepTimestamps.${to}`]: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, { action: opts.action, from: study.status, to });
      return fields;
    });
  }

  /**
   * Fields without a status change, allowed only in the given statuses.
   * Audited only when an action name is given.
   */
  async patch(fields: Record<string, unknown>, opts: { allowedIn: readonly StudyStatus[]; action?: string }): Promise<void> {
    await this.ref.firestore.runTransaction(async (tx) => {
      const study = await this.read(tx);
      this.assertOwnRun(study);
      if (!opts.allowedIn.includes(study.status)) {
        throw new WrongStateError(study.status, opts.allowedIn.map((s) => `status ${s}`));
      }
      tx.update(this.ref, { ...fields, updatedAt: FieldValue.serverTimestamp() });
      if (opts.action) this.audit(tx, { action: opts.action, from: study.status, to: study.status });
    });
  }

  /**
   * Fields computed from the study as read inside the transaction, so checks
   * and writes see the same data; optionally a legal status move, and an
   * audit entry that may carry decision details. `compute` may throw to
   * abort without writing.
   */
  async updateWith(
    compute: (data: FirebaseFirestore.DocumentData, status: StudyStatus) => {
      fields: Record<string, unknown>;
      to?: StudyStatus;
      detail?: Record<string, unknown>;
    },
    opts: { allowedIn: readonly StudyStatus[]; action: string },
  ): Promise<{ from: StudyStatus; to: StudyStatus }> {
    return this.ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(this.ref);
      const study = await this.read(tx);
      this.assertOwnRun(study);
      if (!opts.allowedIn.includes(study.status)) {
        throw new WrongStateError(study.status, opts.allowedIn.map((s) => `status ${s}`));
      }
      const out = compute(snap.data() ?? {}, study.status);
      const to = out.to ?? study.status;
      if (to !== study.status) assertTransition(study.status, to);
      tx.update(this.ref, {
        ...out.fields,
        ...(to !== study.status ? { status: to, [`pipeline.stepTimestamps.${to}`]: Timestamp.now() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, { action: opts.action, from: study.status, to, ...(out.detail ? { detail: out.detail } : {}) });
      return { from: study.status, to };
    });
  }

  /** Stop the run with a code the app maps to copy. */
  async fail(error: { code: PipelineErrorCode; message: string; at: StudyStatus }): Promise<void> {
    await this.advance(
      "failed",
      { "pipeline.error": { code: error.code, message: error.message.slice(0, 300), at: error.at } },
      { action: "pipeline_failed", code: error.code },
    );
  }

  /**
   * Put the study back in the queue. A manual retry resets the attempt
   * count so the sweeper may try again; an automatic requeue goes through
   * `retryLater`, which counts.
   */
  async requeue(reason: { action: string; resetAttempts?: boolean; fields?: Record<string, unknown> }): Promise<void> {
    const fields: Record<string, unknown> = {
      ...(reason.resetAttempts ? { "pipeline.attempts": 0, "pipeline.lastError": FieldValue.delete() } : {}),
      ...reason.fields,
    };
    await this.advance("queued", fields, { action: reason.action });
  }

  /**
   * A failure that may be temporary: requeue while attempts remain,
   * otherwise fail. Decided inside the transaction on the current count, so
   * concurrent writers cannot both requeue past the limit.
   */
  async retryLater(
    error: { code: PipelineErrorCode; message: string; at: StudyStatus },
    opts: { countAttempt?: boolean } = {},
  ): Promise<"requeue" | "fail"> {
    const countAttempt = opts.countAttempt !== false;
    return this.ref.firestore.runTransaction(async (tx) => {
      const study = await this.read(tx);
      this.assertOwnRun(study);
      const attempts = study.attempts;
      const step = nextStep(error.code, attempts, { countAttempt });
      const to: StudyStatus = step === "requeue" ? "queued" : "failed";
      assertTransition(study.status, to);
      const lastError = { code: error.code, message: error.message.slice(0, 300), at: error.at };
      tx.update(this.ref, {
        status: to,
        "pipeline.attempts": countAttempt ? attempts + 1 : attempts,
        "pipeline.lastError": lastError,
        ...(step === "fail" ? { "pipeline.error": lastError } : {}),
        [`pipeline.stepTimestamps.${to}`]: Timestamp.now(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      this.audit(tx, {
        action: step === "fail" ? "pipeline_failed" : countAttempt ? "pipeline_requeued" : "pipeline_waiting_for_models",
        from: study.status,
        to,
        code: error.code,
      });
      return step;
    });
  }

  /** Set or clear flags; never changes status. */
  async setFlags(flags: Partial<StudyFlags>, allowedIn: readonly StudyStatus[]): Promise<void> {
    const fields = Object.fromEntries(Object.entries(flags).map(([k, v]) => [`flags.${k}`, v]));
    await this.patch(fields, { allowedIn, action: "flags_changed" });
  }

  private async read(tx: Transaction): Promise<StudySnapshot> {
    const snap = await tx.get(this.ref);
    if (!snap.exists) throw new WrongStateError("missing", ["an existing study"]);
    const status = snap.get("status");
    if (!isStudyStatus(status)) throw new WrongStateError("missing", ["a valid status"], `Unknown status ${String(status)}.`);
    return {
      status,
      runId: (snap.get("pipeline.runId") as string | null | undefined) ?? null,
      attempts: Number(snap.get("pipeline.attempts") ?? 0),
    };
  }

  private assertOwnRun(study: StudySnapshot): void {
    if (this.runId && study.runId !== this.runId) {
      throw new WrongStateError(study.status, ["this run to own the study"], "Another run owns this study.");
    }
  }

  private audit(tx: Transaction, entry: Omit<AuditEntry, "at" | "actor" | "runId">): void {
    const doc: AuditEntry = {
      at: FieldValue.serverTimestamp(),
      actor: typeof this.actor === "string" ? this.actor : `user:${this.actor.uid}`,
      ...entry,
      ...(this.runId ? { runId: this.runId } : {}),
    };
    if (doc.code === undefined) delete doc.code;
    tx.set(this.ref.collection("audit").doc(), doc);
  }
}
