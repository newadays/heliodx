/**
 * B17 · The patient-summary PDF, rendered on the server so it always matches
 * the summary that passed the share gate. Patient summary only: no image, no
 * findings, impression, recommendation or confidence. Same fields the app's
 * template had (org, date, "Prepared for", title, body, next steps,
 * attribution, disclaimer). Built-in Helvetica, no browser.
 */
import PDFDocument from "pdfkit";

export interface SharePdfInput {
  orgName: string;
  orgLegalName?: string;
  /** Already formatted, e.g. "28 October 2026". */
  date: string;
  patientName: string;
  title: string;
  body: string;
  steps: string[];
  attribution: string;
  /**
   * §4.11 · Case line, e.g. "Case U-7K2P · uploaded by Dr. … · HelioDX research prototype".
   * When present it carries the provenance, so the attribution line names no organization.
   */
  footer?: string;
}

export const DISCLAIMER =
  "This summary explains your result in plain language. It is not a full report; your clinician holds the complete findings and will answer your questions.";

const INK = "#0F172A";
const MUTED = "#64748B";
const RULE = "#E2E8F0";

export const PROTOTYPE = "HelioDX research prototype";

/**
 * The "Prepared for" name. An upload's name is the uploader's pseudonym label,
 * which could be a real name typed by mistake, so its PDF says "Prepared for
 * you" instead.
 */
export function pdfPatientName(study: { source?: string; patient?: { name?: string } }): string {
  return study.source === "upload" ? "" : (study.patient?.name ?? "");
}

/** §4.11 · The case line under the disclaimer, by source; null for studies without one. */
export function caseFooter(study: { caseId?: string; source?: string; clinicianName?: string }): string | null {
  const id = study.caseId ? `Case ${study.caseId}` : null;
  if (study.source === "sample") return [id, "sample study, synthetic patient", PROTOTYPE].filter(Boolean).join(" · ");
  if (study.source === "upload") return [id, `uploaded by ${study.clinicianName || "the clinician"}`, "de-identified in browser", PROTOTYPE].filter(Boolean).join(" · ");
  return null;
}

/** "Reviewed and approved by Dr. X", plus the organization only when no case line follows (it would repeat). */
export function attributionLine(i: Pick<SharePdfInput, "attribution" | "orgName" | "footer">): string {
  return i.footer ? i.attribution : `${i.attribution} · ${i.orgName}`;
}

export function formatShareDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

export function buildSharePdf(i: SharePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 72, bottom: 72, left: 62, right: 62 }, info: { Title: i.title, Producer: "HelioDX" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const org = (i.orgLegalName?.trim() || i.orgName.trim()) || "HelioDX";

    // Header: organization left, date right, rule below.
    const top = doc.y;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(org, left, top, { width: width * 0.65 });
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(i.date, left, top, { width, align: "right" });
    doc.moveDown(0.8);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(RULE).lineWidth(1).stroke();
    doc.moveDown(1.6);

    doc.font("Helvetica").fontSize(11).fillColor(MUTED).text(`Prepared for ${i.patientName.trim() || "you"}`, left, doc.y, { width });
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(i.title, { width });
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(12).fillColor(INK).text(i.body, { width, lineGap: 3 });
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("What happens next", { width });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(12).fillColor(INK);
    if (i.steps.length) {
      doc.list(i.steps, { width, bulletRadius: 2, textIndent: 14, lineGap: 3, paragraphGap: 4 });
    } else {
      doc.text("Your clinician will talk with you about what happens next.", { width });
    }

    doc.moveDown(2);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(RULE).lineWidth(1).stroke();
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(attributionLine(i), left, doc.y, { width });
    doc.moveDown(0.3);
    doc.text(DISCLAIMER, { width });
    if (i.footer) {
      doc.moveDown(0.3);
      doc.text(i.footer, { width });
    }
    doc.end();
  });
}
