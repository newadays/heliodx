/**
 * B17 · Share the patient summary. The server is the gate (lib/shareRules.ts):
 * written from the signed report, every next step confirmed, consent given,
 * the final text still passing the B16 checks, channel allowed. It renders
 * the PDF (lib/sharePdf.ts), stores it under the study, signs a 15-minute
 * download URL for the app and, for WhatsApp/email, a patient link valid for
 * the organization's `linkExpiryDays`. The share record and an audit entry
 * with the clinician's decisions are written in one transaction, where the
 * gate is checked again; the first share moves the study to `shared`.
 *
 * The backend never contacts WhatsApp or an email provider: the app hands
 * off to the OS. The target (phone/email) comes from the study, not the
 * caller. Logs carry ids and the channel only.
 */
import { randomUUID } from "node:crypto";

import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { wrongState } from "../lib/callableErrors";
import { buildSharePdf, caseFooter, formatShareDate, pdfPatientName } from "../lib/sharePdf";
import {
  isShareChannel,
  SENDING_CHANNELS_ENABLED,
  shareDecisions,
  shareNeeds,
  sharePolicyOf,
  type ShareableStudy,
  type ShareChannel,
  type ShareNeed,
  type StoredStep,
} from "../lib/shareRules";
import { SigningError, signedReadUrl } from "../lib/signedUrl";
import { WrongStateError, type StudyStatus } from "../study/stateMachine";
import { StudyWriter } from "../study/writer";
import { traceEvent, traceScope } from "../lib/trace";
import { studyDirOf } from "../lib/storagePaths";
import { asCaller, callerOf, canAct, type Caller } from "../lib/access";

export const SHARE_IN: readonly StudyStatus[] = ["patient_summary_ready", "shared"];
const DOWNLOAD_MINUTES = 15;
const NOTE_MAX = 300;

export interface ShareRequest {
  studyId: string;
  channel: ShareChannel;
  consent: boolean;
  consentNote?: string;
}

export interface ShareResult {
  shareId: string;
  /** For the app to fetch the PDF (attach / save); 15 minutes. */
  downloadUrl: string;
  /** For the patient (WhatsApp/email message); the org's linkExpiryDays. */
  link?: string;
  linkExpiresAt?: string;
}

export class NotReadyToShare extends Error {
  constructor(
    readonly needs: ShareNeed[],
    readonly steps: number[],
  ) {
    super(`Not ready to share: ${needs.join(", ")}`);
    this.name = "NotReadyToShare";
  }
}

export const NEED_TEXT: Record<ShareNeed, string> = {
  write_summary: "Write the patient summary from your signed report.",
  confirm_steps: "Confirm each next step.",
  consent: "Record that the patient agreed to receive it.",
  step_adds_instruction: "A next step says something your signed report doesn't. Edit it to match the report.",
  body_names_condition: "The summary names a condition your signed impression doesn't. Edit it.",
  channel_off: "Your organization has turned this channel off.",
  no_phone: "Add the patient's phone number first.",
  no_email: "Add the patient's email address first.",
};

type StudyDoc = ShareableStudy & { clinicianUid?: string; orgId?: string; status?: StudyStatus };

export interface ShareDeps {
  db: Firestore;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
  sign?: typeof signedReadUrl;
  now?: () => Date;
}

function stepsText(study: StudyDoc): string[] {
  const steps = study.patientSummary?.nextSteps;
  return Array.isArray(steps) ? steps.map((s: StoredStep) => (s.text ?? "").trim()).filter(Boolean) : [];
}

function targetFor(channel: ShareChannel, study: StudyDoc): string {
  if (channel === "whatsapp") return study.patient?.phone ?? "";
  if (channel === "email") return study.patient?.email ?? "";
  return "";
}

export async function shareStudyCore(deps: ShareDeps, caller: Caller, req: ShareRequest): Promise<ShareResult> {
  const { uid, orgId } = asCaller(caller);
  const { db } = deps;
  const sign = deps.sign ?? signedReadUrl;
  const now = (deps.now ?? (() => new Date()))();
  if (!isShareChannel(req.channel)) throw new HttpsError("invalid-argument", "channel must be whatsapp, email or pdf.");
  if (!SENDING_CHANNELS_ENABLED && req.channel !== "pdf") throw new HttpsError("invalid-argument", "Only a PDF can be shared for now; sending by WhatsApp or email is not available yet.");
  const consent = req.consent === true;
  const note = typeof req.consentNote === "string" ? req.consentNote.trim().slice(0, NOTE_MAX) : "";

  const ref = db.collection("studies").doc(req.studyId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Study not found.");
  const study = snap.data() as StudyDoc;
  if (!canAct(study, uid, orgId)) throw new HttpsError("permission-denied", "Only the clinician who owns this study can share it.");
  if (!study.status || !SHARE_IN.includes(study.status)) throw new WrongStateError(study.status ?? "missing", SHARE_IN.map((s) => `status ${s}`));

  const org = study.orgId ? await db.collection("organizations").doc(study.orgId).get() : null;
  const policy = sharePolicyOf(org?.get("sharePolicy"));
  const check = shareNeeds(study, { channel: req.channel, consent }, policy);
  if (check.needs.length) throw new NotReadyToShare(check.needs, check.stepsAddingInstructions);

  return traceScope(ref, "sharing", () => shareChecked(deps, uid, req, { study, org, policy, consent, note, now, sign }));
}

async function shareChecked(
  deps: ShareDeps,
  uid: string,
  req: ShareRequest,
  c: {
    study: StudyDoc;
    org: FirebaseFirestore.DocumentSnapshot | null;
    policy: ReturnType<typeof sharePolicyOf>;
    consent: boolean;
    note: string;
    now: Date;
    sign: typeof signedReadUrl;
  },
): Promise<ShareResult> {
  const { bucket, db } = deps;
  const { study, org, policy, consent, note, now, sign } = c;
  const ref = db.collection("studies").doc(req.studyId);
  traceEvent({ kind: "check", name: "share_gate", args: { channel: req.channel }, ok: true, result: `passed · summary from signed report · ${consent ? "consent recorded" : "consent not recorded"}` });

  // ---- PDF -----------------------------------------------------------------
  const ps = study.patientSummary!;
  const orgName = (org?.get("name") as string | undefined) ?? "HelioDX";
  const pdf = await buildSharePdf({
    orgName,
    orgLegalName: org?.get("legalName") as string | undefined,
    date: formatShareDate(now),
    patientName: pdfPatientName(study as { source?: string; patient?: { name?: string } }),
    title: ps.title ?? "",
    body: ps.body ?? "",
    steps: stepsText(study),
    attribution: ps.attribution?.trim() || `Reviewed by ${ps.reviewedBy ?? "your clinician"}`,
    footer: caseFooter(study as { caseId?: string; source?: string; clinicianName?: string }) ?? undefined,
  });
  const shareId = randomUUID().replace(/-/g, "").slice(0, 16);
  const pdfPath = `${studyDirOf(req.studyId, study)}/shares/${shareId}.pdf`;
  traceEvent({ kind: "tool", name: "render_pdf", args: { channel: req.channel }, ok: true, result: `${Math.round(pdf.length / 1024)} KB · summary, attribution and disclaimer only` });
  const file = bucket.file(pdfPath);
  await file.save(pdf, {
    contentType: "application/pdf",
    resumable: false,
    metadata: { metadata: { studyId: req.studyId, orgId: study.orgId ?? "", shareId, channel: req.channel } },
  });

  try {
    // B24: the clinician's copy saves as HelioDX-<caseId>-patient-note.pdf.
    const caseId = (study as { caseId?: string }).caseId || req.studyId.slice(0, 6);
    const downloadUrl = await sign(file, new Date(now.getTime() + DOWNLOAD_MINUTES * 60_000), `HelioDX-${caseId}-patient-note.pdf`);
    const linkExpires = new Date(now.getTime() + Math.max(1, policy.linkExpiryDays) * 24 * 60 * 60_000);
    const link = req.channel === "pdf" ? undefined : await sign(file, linkExpires);

    await new StudyWriter(ref, { uid }).updateWith(
      (data, status) => {
        const current = data as StudyDoc;
        const again = shareNeeds(current, { channel: req.channel, consent }, policy);
        if (again.needs.length) throw new NotReadyToShare(again.needs, again.stepsAddingInstructions);
        const decisions = shareDecisions(current);
        const record = {
          id: shareId,
          channel: req.channel,
          target: targetFor(req.channel, current),
          sentAt: Timestamp.fromDate(now),
          pdfPath,
          ...(link ? { linkExpiresAt: Timestamp.fromDate(linkExpires) } : {}),
          consent: { given: consent, note, by: uid, at: Timestamp.fromDate(now) },
          ...decisions,
        };
        const shares = Array.isArray(data.shares) ? data.shares : [];
        return {
          fields: { shares: [...shares, record] },
          to: status === "patient_summary_ready" ? "shared" : status,
          detail: { shareId, channel: req.channel, consentNote: note, ...decisions },
        };
      },
      { allowedIn: SHARE_IN, action: "study_shared" },
    );
    return { shareId, downloadUrl, ...(link ? { link, linkExpiresAt: linkExpires.toISOString() } : {}) };
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}

export const shareStudy = onCall<ShareRequest, Promise<ShareResult>>(
  { enforceAppCheck: false, timeoutSeconds: 60, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
    const studyId = request.data?.studyId;
    if (typeof studyId !== "string" || !studyId) throw new HttpsError("invalid-argument", "studyId is required.");
    try {
      const out = await shareStudyCore({ db: getFirestore(), bucket: getStorage().bucket() }, callerOf(request.auth), request.data);
      logger.info("shareStudy: shared", { studyId, channel: request.data.channel, shareId: out.shareId });
      return out;
    } catch (error) {
      if (error instanceof NotReadyToShare) {
        throw new HttpsError("failed-precondition", error.needs.map((n) => NEED_TEXT[n]).join(" "), {
          error: "not_ready_to_share",
          needs: error.needs,
          steps: error.steps,
        });
      }
      if (error instanceof WrongStateError) throw wrongState(error, "Write and confirm the patient summary before sharing.");
      if (error instanceof SigningError) {
        logger.error("shareStudy: signing failed", { studyId, message: error.message });
        throw new HttpsError("internal", "Couldn't create the share link. Check the service account's signing permission.");
      }
      throw error;
    }
  },
);
