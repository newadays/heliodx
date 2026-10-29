/**
 * B14 · Radiologist reads: assigning one (the clinician's request, or the
 * coordinator tick for critical and flagged cases) and the simulated readers'
 * timers. Every change goes through the StudyWriter with an audit entry and a
 * trace row in the case's "radiology" stage. A fast or slow reader signs once
 * its ETA passes; a silent one is nudged, then the read moves to the fast
 * reader. A signed read clears `needsHuman`, so an escalated case can be signed.
 */
import { Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { traceEvent, traceScope } from "../lib/trace";
import { WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter, type Actor } from "../study/writer";
import { AUTO_REASONS, readRequirement, READ_REASON_TEXT, type GateStudy, type RadiologistRead, type ReadReason } from "./gate";
import { fastReader, NUDGE_GRACE_MS, pickReader, READ_MS, READ_NOTE, readerLabel, rosterOf, type Radiologist } from "./roster";

/** Statuses a read can be opened or progressed in: drafted, not yet signed. */
export const READ_STATUSES: readonly StudyStatus[] = ["ready", "clinician_review"];

class AlreadyDone extends Error {}

const ms = (t: unknown): number => (t && typeof (t as { toMillis?: unknown }).toMillis === "function" ? (t as { toMillis(): number }).toMillis() : 0);
const at = (m: number) => Timestamp.fromMillis(m);

async function rosterFor(db: Firestore, orgId: unknown): Promise<Radiologist[]> {
  if (typeof orgId !== "string" || !orgId) return rosterOf(undefined);
  const snap = await db.collection("organizations").doc(orgId).get();
  return rosterOf(snap.data());
}

function assignment(reader: Radiologist, reason: ReadReason, now: number, extra: Partial<RadiologistRead> = {}): RadiologistRead {
  return {
    required: true,
    reason,
    status: "assigned",
    assignee: reader.id,
    assigneeName: reader.name,
    profile: reader.profile,
    simulated: true,
    assignedAt: at(now),
    eta: at(now + READ_MS[reader.profile]),
    ...extra,
  };
}

/**
 * Opens a read. `requestedBy` is the clinician who asked (reason "requested"
 * unless a stronger reason already applies). Returns false when a read
 * already exists or nothing requires one.
 */
export async function assignRead(
  db: Firestore,
  ref: DocumentReference,
  opts: { actor: Actor; now: number; requestedBy?: string; reader?: Radiologist },
): Promise<boolean> {
  const first = (await ref.get()).data();
  if (!first) return false;
  const roster = await rosterFor(db, first.orgId);
  try {
    await traceScope(ref, "radiology", async () => {
      let read: RadiologistRead | null = null;
      await new StudyWriter(ref, opts.actor).updateWith(
        (data) => {
          if ((data as GateStudy).radiologistRead?.status) throw new AlreadyDone();
          const gate = readRequirement({ ...(data as GateStudy), radiologistRead: opts.requestedBy ? { requestedBy: opts.requestedBy } : null });
          if (!gate) throw new AlreadyDone();
          const reader = opts.reader ?? pickReader(roster, { id: ref.id, priority: data.priority });
          read = assignment(reader, gate.reason, opts.now, opts.requestedBy ? { requestedBy: opts.requestedBy } : {});
          return { fields: { radiologistRead: read }, detail: { assignee: reader.id, profile: reader.profile, reason: gate.reason } };
        },
        { allowedIn: READ_STATUSES, action: "radiologist_read_assigned" },
      );
      const r = read as RadiologistRead | null;
      if (r) {
        traceEvent({
          kind: "check",
          name: "assign_read",
          args: { profile: r.profile, reason: r.reason },
          ok: true,
          result: `Sent to ${readerLabel(r.assigneeName)} · ${READ_REASON_TEXT[r.reason]} · ETA ${Math.round(READ_MS[r.profile] / 60_000)} min`,
        });
      }
    });
    return true;
  } catch (error) {
    if (error instanceof AlreadyDone || error instanceof WrongStateError) return false;
    throw error;
  }
}

type Step = "sign" | "nudge" | "reassign" | null;
/** Trace names of the read steps (the console manifest lists them). */
export const STEP_NAME = { sign: "sign_read", nudge: "nudge_read", reassign: "reassign_read" } as const;

/** What a simulated reader does now with an open read. */
export function readStep(read: Pick<RadiologistRead, "status" | "profile" | "eta" | "nudgedAt">, now: number): Step {
  if (read.status !== "assigned") return null;
  if (read.profile !== "silent") return now >= ms(read.eta) ? "sign" : null;
  if (!read.nudgedAt) return now >= ms(read.eta) ? "nudge" : null;
  return now >= ms(read.nudgedAt) + NUDGE_GRACE_MS ? "reassign" : null;
}

/** Progresses one open read: sign, nudge or reassign, re-checked inside the transaction. */
export async function stepRead(db: Firestore, ref: DocumentReference, now: number, force?: "sign"): Promise<Step> {
  const first = (await ref.get()).data();
  const read0 = first?.radiologistRead as RadiologistRead | undefined;
  if (!read0) return null;
  const step: Step = force ?? readStep(read0, now);
  if (!step) return null;
  const fast = step === "reassign" ? fastReader(await rosterFor(db, first?.orgId)) : null;
  try {
    await traceScope(ref, "radiology", async () => {
      let line = "";
      await new StudyWriter(ref, step === "sign" ? "radiologist" : "coordinator").updateWith(
        (data) => {
          const read = data.radiologistRead as RadiologistRead | undefined;
          if (!read || read.status !== "assigned" || (!force && readStep(read, now) !== step)) throw new AlreadyDone();
          const who = readerLabel(read.assigneeName);
          if (step === "sign") {
            const note = READ_NOTE[read.profile];
            line = `Read signed by ${who} · ${note}`;
            return {
              fields: { "radiologistRead.status": "signed", "radiologistRead.signedAt": at(now), "radiologistRead.note": note, "flags.needsHuman": false },
              detail: { assignee: read.assignee, profile: read.profile },
            };
          }
          if (step === "nudge") {
            line = `Reminder sent to ${who}; no answer since ${Math.round((now - ms(read.assignedAt)) / 60_000)} min`;
            return { fields: { "radiologistRead.nudgedAt": at(now) }, detail: { assignee: read.assignee } };
          }
          const next = fast!;
          line = `Reassigned from ${who} to ${readerLabel(next.name)} · ETA ${Math.round(READ_MS[next.profile] / 60_000)} min`;
          return {
            fields: { radiologistRead: assignment(next, read.reason, now, { reassignedFrom: read.assigneeName, ...(read.requestedBy ? { requestedBy: read.requestedBy } : {}) }) },
            detail: { from: read.assignee, to: next.id },
          };
        },
        { allowedIn: READ_STATUSES, action: step === "sign" ? "radiologist_read_signed" : step === "nudge" ? "radiologist_read_nudged" : "radiologist_read_reassigned" },
      );
      traceEvent({ kind: "check", name: STEP_NAME[step], args: { profile: step === "reassign" ? fast!.profile : read0.profile }, ok: true, result: line });
    });
    return step;
  } catch (error) {
    if (error instanceof AlreadyDone || error instanceof WrongStateError) return null;
    throw error;
  }
}

/** The tick's read pass: opens reads that critical or flagged cases need, then moves every open read along. */
export async function runReads(db: Firestore, now: number, studies: ({ id: string; status: string } & GateStudy)[]): Promise<{ opened: number; stepped: number }> {
  let opened = 0;
  let stepped = 0;
  for (const s of studies) {
    if (!READ_STATUSES.includes(s.status as StudyStatus) || s.radiologistRead?.status) continue;
    const gate = readRequirement(s);
    if (!gate || !AUTO_REASONS.has(gate.reason)) continue;
    try {
      if (await assignRead(db, db.collection("studies").doc(s.id), { actor: "coordinator", now })) opened++;
    } catch (error) {
      logger.warn("radiology: assign failed", { studyId: s.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const open = await db.collection("studies").where("radiologistRead.status", "==", "assigned").limit(100).get();
  for (const d of open.docs) {
    try {
      if (await stepRead(db, d.ref, now)) stepped++;
    } catch (error) {
      logger.warn("radiology: step failed", { studyId: d.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { opened, stepped };
}
