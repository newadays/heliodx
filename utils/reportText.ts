/**
 * The clinician report as plain text for "Copy report" (design 04b), ready
 * to paste into a record system. Deliberately omits patient identifiers:
 * the destination already knows who the patient is, and the clipboard is
 * the least controlled place for a name to sit.
 */

export interface ReportInput {
  studyType: string;
  findings: string;
  impression: string[];
  recommendation: string;
  reviewedBy: string;
  /** Already formatted, e.g. "26 Oct 2026". */
  date?: string;
  /** Appended when true; the report is AI-drafted and clinician-reviewed. */
  aiDrafted?: boolean;
  /** Set once signed (card F7): who, when, and the SHA-256 of the frozen report. */
  signature?: { by: string; date: string; hash: string };
}

export function reportText(r: ReportInput): string {
  const lines: string[] = [];
  lines.push(r.studyType.trim().toUpperCase() || "STUDY");
  if (r.date) lines.push(r.date);
  lines.push("");
  lines.push("FINDINGS");
  lines.push(r.findings.trim());
  lines.push("");
  lines.push("IMPRESSION");
  const impression = r.impression.map((s) => s.trim()).filter(Boolean);
  if (impression.length === 0) lines.push("None.");
  else if (impression.length === 1) lines.push(impression[0]);
  else impression.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");
  lines.push("RECOMMENDATION");
  lines.push(r.recommendation.trim() || "None.");
  lines.push("");
  if (r.signature) {
    lines.push(`Signed by ${r.signature.by.trim()}${r.signature.date ? `, ${r.signature.date}` : ""}`);
    lines.push(`Report hash ${r.signature.hash}`);
  } else {
    lines.push(`Reviewed by ${r.reviewedBy.trim()}`);
  }
  if (r.aiDrafted) lines.push("Drafted with AI assistance and reviewed by the clinician.");
  return lines.join("\n");
}
