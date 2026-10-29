/**
 * §4.11 · How a study's source reads, in words rather than colour: the
 * worklist meta and study lines, the console's Received step and the viewer
 * status bar all come from here, so an upload and a sample can never be told
 * apart by colour alone.
 */
import type { Study } from "@/types/study";

type SourceStudy = Pick<Study, "source" | "clinicianName" | "studyType"> &
  Partial<Pick<Study, "caseId" | "view" | "details" | "demo" | "upload" | "createdAt">>;

const FORMAT = { dicom: "DICOM", jpeg: "JPEG", png: "PNG" } as const;

export function isSampleStudy(study: Pick<Study, "source">): boolean {
  return study.source === "sample";
}

/** "Dr. Demo Clinician" → "DC" (titles dropped). */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").replace(/^(Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") : "—";
}

/** "PA" | "AP" | null, from the detected view, the details given, or the study type. */
export function viewOf(study: SourceStudy): "PA" | "AP" | null {
  return study.view ?? study.details?.view ?? ((/\((PA|AP)\)/.exec(study.studyType ?? "")?.[1] as "PA" | "AP" | undefined) ?? null);
}

/** "34 M", or null when unknown. */
export function ageSexOf(study: SourceStudy): string | null {
  const d = study.details ?? study.demo;
  // Uploads store every age from 90 up as 90 (functions/src/lib/uploads.ts).
  return d?.age && d?.sex ? `${d.age >= 90 ? "90+" : d.age} ${d.sex}` : null;
}

/** Upload facts: "JPEG · 14 tags removed · 1 redaction". */
export function uploadFacts(study: SourceStudy): string | null {
  const u = study.upload;
  if (!u) return null;
  return [
    FORMAT[u.format] ?? u.format.toUpperCase(),
    u.removedTags ? `${u.removedTags} tag${u.removedTags === 1 ? "" : "s"} removed` : "metadata removed",
    u.redactions?.length ? `${u.redactions.length} redaction${u.redactions.length === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Study column, second line: "PA · JPEG · 14 tags removed" | "PA · NIH ChestX-ray14". */
export function studyLine(study: SourceStudy): string {
  const view = viewOf(study);
  const what = isSampleStudy(study) ? "NIH ChestX-ray14" : (uploadFacts(study) ?? "1 image");
  return [view, what].filter(Boolean).join(" · ");
}

/** Viewer status bar: "Uploaded JPEG · de-identified in browser · …" | "NIH ChestX-ray14 · synthetic patient". */
export function provenanceLine(study: SourceStudy): string | null {
  if (isSampleStudy(study)) return "NIH ChestX-ray14 · synthetic patient";
  const u = study.upload;
  if (!u) return null;
  const rest = (uploadFacts(study) ?? "").split(" · ").slice(1);
  return [`Uploaded ${FORMAT[u.format] ?? u.format.toUpperCase()}`, "de-identified in browser", ...rest].join(" · ");
}

/** The console's Received step summary. */
export function receivedLine(study: SourceStudy): string {
  const kind = (study.studyType || "Chest X-ray").replace(/\s*\((PA|AP)\)\s*$/, "");
  const base = [kind, viewOf(study), ageSexOf(study)];
  if (isSampleStudy(study)) return [...base, `from sample${study.caseId ? ` ${study.caseId}` : ""}`].filter(Boolean).join(" · ");
  return [...base, `uploaded by ${initials(study.clinicianName)}`, uploadFacts(study)].filter(Boolean).join(" · ");
}
