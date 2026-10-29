/**
 * B17 · What must hold before the patient summary leaves the clinic, checked
 * on the server (the app's own checks are a convenience, not the gate):
 *
 * - the summary was written from the signed report (hash matches),
 * - the final text still passes the B16 checks: no step adds an
 *   instruction its signed sentence lacks, the body names no condition the
 *   signed Impression lacks (a clinician edit can't slip one in),
 * - the channel is allowed and has a target; sending channels also need the
 *   patient's consent.
 *
 * SPEC §4.6a (28 Oct): for now the only share is a PDF. WhatsApp and email
 * are deferred (`SENDING_CHANNELS_ENABLED`), consent is optional for a PDF
 * (recorded either way), and the per-step confirmation gate is gone: the
 * check against the signed report covers it.
 *
 * Also derives the decisions recorded with the share (which steps were
 * confirmed, edited or taken from the signed text). Pure; no I/O.
 */
import { bodyConditionViolations, conditionViolations, newInstructionTerms, recommendationSentences } from "./patientSummary";

export const SHARE_CHANNELS = ["whatsapp", "email", "pdf"] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

export type ShareNeed =
  | "write_summary"
  | "confirm_steps"
  | "consent"
  | "step_adds_instruction"
  | "body_names_condition"
  | "channel_off"
  | "no_phone"
  | "no_email";

export interface SharePolicy {
  whatsapp: boolean;
  email: boolean;
  pdf: boolean;
  linkExpiryDays: number;
}

/** WhatsApp and email return with §4.6b; until then only a PDF can be shared. */
export const SENDING_CHANNELS_ENABLED = false;

export const DEFAULT_SHARE_POLICY: SharePolicy = { whatsapp: true, email: true, pdf: true, linkExpiryDays: 7 };

export interface StoredStep {
  text?: string;
  mapsTo?: number;
  confirmed?: boolean;
  fromSignedText?: boolean;
}

export interface ShareableStudy {
  patientSummary?: {
    title?: string;
    body?: string;
    nextSteps?: StoredStep[] | string;
    reviewedBy?: string;
    attribution?: string;
    generatedFromReportHash?: string | null;
    editedByClinician?: boolean;
    generated?: { body?: string; steps?: string[] };
  } | null;
  signed?: { reportHash?: string; name?: string } | null;
  report?: { summary?: { impression?: string[]; recommendation?: string } } | null;
  patient?: { name?: string; phone?: string | null; email?: string | null } | null;
}

export interface ShareCheck {
  needs: ShareNeed[];
  /** 1-based step numbers that add an instruction the signed sentence lacks. */
  stepsAddingInstructions: number[];
}

export function isShareChannel(value: unknown): value is ShareChannel {
  return typeof value === "string" && (SHARE_CHANNELS as readonly string[]).includes(value);
}

export function sharePolicyOf(raw: Partial<SharePolicy> | null | undefined): SharePolicy {
  const policy = { ...DEFAULT_SHARE_POLICY, ...(raw ?? {}) };
  return SENDING_CHANNELS_ENABLED ? policy : { ...policy, whatsapp: false, email: false };
}

export function shareNeeds(study: ShareableStudy, req: { channel: ShareChannel; consent: boolean }, policy: SharePolicy): ShareCheck {
  const needs: ShareNeed[] = [];
  const ps = study.patientSummary;
  const steps = Array.isArray(ps?.nextSteps) ? ps.nextSteps : null;
  const fromSigned = !!ps && !!study.signed?.reportHash && ps.generatedFromReportHash === study.signed.reportHash && !!steps;
  const stepsAddingInstructions: number[] = [];

  if (!fromSigned) {
    needs.push("write_summary");
  } else {
    const sentences = recommendationSentences(study.report?.summary?.recommendation ?? "");
    steps!.forEach((s, i) => {
      const signed = sentences[s.mapsTo ?? i] ?? "";
      const text = s.text ?? "";
      if (newInstructionTerms(signed, text).length || conditionViolations(text, study.report?.summary?.impression ?? [], signed).length) stepsAddingInstructions.push(i + 1);
    });
    if (stepsAddingInstructions.length) needs.push("step_adds_instruction");
    if (bodyConditionViolations(ps!.body ?? "", study.report?.summary?.impression ?? []).length) needs.push("body_names_condition");
  }
  // A PDF is printed or handed over in person: consent is recorded when given, never required.
  if (req.channel !== "pdf" && req.consent !== true) needs.push("consent");
  if (!policy[req.channel]) needs.push("channel_off");
  if (req.channel === "whatsapp" && !study.patient?.phone) needs.push("no_phone");
  if (req.channel === "email" && !study.patient?.email) needs.push("no_email");
  return { needs, stepsAddingInstructions };
}

/** The clinician's decisions, recorded with the share and in the audit (no text). */
export function shareDecisions(study: ShareableStudy): {
  generatedFromReportHash: string | null;
  summaryEdited: boolean;
  bodyEdited: boolean;
  steps: { mapsTo: number; confirmed: boolean; edited: boolean; fromSignedText: boolean }[];
} {
  const ps = study.patientSummary ?? {};
  const steps = Array.isArray(ps.nextSteps) ? ps.nextSteps : [];
  const gen = ps.generated ?? {};
  const bodyEdited = gen.body !== undefined ? (ps.body ?? "").trim() !== gen.body.trim() : !!ps.editedByClinician;
  const out = steps.map((s, i) => {
    const original = gen.steps?.[i];
    const edited = original !== undefined ? (s.text ?? "").trim() !== original.trim() : !!ps.editedByClinician;
    return { mapsTo: s.mapsTo ?? i, confirmed: s.confirmed === true, edited, fromSignedText: s.fromSignedText === true && !edited };
  });
  return {
    generatedFromReportHash: ps.generatedFromReportHash ?? null,
    summaryEdited: bodyEdited || out.some((s) => s.edited) || !!ps.editedByClinician,
    bodyEdited,
    steps: out,
  };
}
