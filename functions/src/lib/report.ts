/**
 * B15 · Sign gates and the report hash. Pure: no Firebase.
 *
 * A study may be signed only when the clinician has decided every finding,
 * any radiologist read the gate requires (B14) is signed, the impression and recommendation exist, the
 * summary matches the review decisions (or the clinician wrote it), and the
 * impression is the clinician's own: edited, or explicitly confirmed.
 */
import { createHash } from "node:crypto";

import { readNeed, type GateStudy } from "../radiology/gate";
import { reviewHash, type ReviewableFinding } from "./reviewHash";

export interface SignableFinding extends ReviewableFinding {
  title: string;
  description: string;
  strength?: "strong" | "moderate" | "weak";
}

export interface SignableStudy {
  studyType?: string;
  modality?: string;
  findings?: SignableFinding[];
  clinicianSummary?: {
    findings?: string;
    impression?: string[];
    recommendation?: string;
    generatedFromReviewHash?: string | null;
    editedByClinician?: boolean;
  } | null;
  priority?: string | null;
  flags?: GateStudy["flags"];
  radiologistRead?: { required?: boolean; status?: string; requestedBy?: string } | null;
}

export type SignNeed =
  | "decide_every_finding"
  | "request_radiologist_read"
  | "close_radiologist_read"
  | "write_impression"
  | "write_recommendation"
  | "refresh_summary"
  | "confirm_impression";

export function signNeeds(study: SignableStudy, opts: { confirmImpression?: boolean } = {}): SignNeed[] {
  const needs: SignNeed[] = [];
  const findings = study.findings ?? [];
  if (findings.some((f) => f.status === "pending")) needs.push("decide_every_finding");
  // B14: the gate rule (radiology/gate.ts) — a required read must exist and be signed.
  const read = readNeed(study);
  if (read === "request") needs.push("request_radiologist_read");
  if (read === "close") needs.push("close_radiologist_read");
  const s = study.clinicianSummary;
  const impression = (s?.impression ?? []).map((x) => x.trim()).filter(Boolean);
  if (!impression.length) needs.push("write_impression");
  if (!(s?.recommendation ?? "").trim()) needs.push("write_recommendation");
  const edited = !!s?.editedByClinician;
  if (s && !edited && s.generatedFromReviewHash !== reviewHash(findings)) needs.push("refresh_summary");
  if (s && !edited && !opts.confirmImpression) needs.push("confirm_impression");
  return needs;
}

/** The text that is frozen and hashed at signing. */
export interface FrozenReport {
  studyId: string;
  studyType: string;
  modality: string;
  findings: { id: string; status: string; title: string; text: string }[];
  summary: { findings: string; impression: string[]; recommendation: string };
  signedBy: string;
  signedAt: string;
}

export function freezeReport(studyId: string, study: SignableStudy, signedBy: string, signedAt: Date): FrozenReport {
  const s = study.clinicianSummary ?? {};
  return {
    studyId,
    studyType: study.studyType ?? "",
    modality: study.modality ?? "",
    findings: [...(study.findings ?? [])]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((f) => ({
        id: f.id,
        status: f.status,
        title: f.title.trim(),
        text: (f.status === "edited" ? (f.editedText ?? "") : f.description).trim(),
      })),
    summary: {
      findings: (s.findings ?? "").trim(),
      impression: (s.impression ?? []).map((x) => x.trim()).filter(Boolean),
      recommendation: (s.recommendation ?? "").trim(),
    },
    signedBy,
    signedAt: signedAt.toISOString(),
  };
}

/** JSON with keys sorted at every level, so the hash does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reportHash(report: FrozenReport): string {
  return `sha256:${createHash("sha256").update(canonicalJson(report)).digest("hex")}`;
}
