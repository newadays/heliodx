/**
 * §4.10 · Clinician uploads. The browser decodes each file, strips every
 * identifier (DICOM tags and photo metadata never leave the machine: only
 * the pixels go, as a lossless PNG), redacts burned-in text, and stages the
 * result at `studies/{orgId}/{uid}/staging/{uploadId}.png`. "Start analysis" turns a staged
 * file into a study here, so a cancelled upload never leaves a partial one.
 * The person confirms, per file, that they contribute the image to an
 * experimental research project; that confirmation is stored with the study.
 */
/** §4.11 · "Sample Patient…" labels belong to sample studies only. */
export const RESERVED_LABEL = /^\s*sample\s+patient/i;
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const CONTRIBUTION_TEXT =
  "This image contains no patient identifiers — on the film or in its metadata. By uploading, you agree to use the images in the beta project.";

export interface UploadDetails {
  label: string;
  age: number | null;
  sex: "F" | "M" | null;
  view: "PA" | "AP" | null;
  indication: string;
}

/** Every age from 90 up is stored as 90 and shown as "90+". */
export const AGE_TOP = 90;

export interface UploadMeta {
  // No file name: DICOM exports and PACS downloads are often named after the
  // patient, so it never leaves the browser (and is ignored if sent).
  format: "dicom" | "jpeg" | "png";
  /** Identifying DICOM tags present in the file (never uploaded). */
  removedTags: number;
  /** Kept DICOM attributes, e.g. { modality: "CR", bodyPart: "CHEST", viewPosition: "PA" }. */
  kept: Record<string, string>;
  /** Burned-in text areas filled in before upload, as 0–1 boxes. */
  redactions: { x: number; y: number; w: number; h: number }[];
  /** Text flagged and kept by the clinician as not identifying. */
  textKept: boolean;
  /** Checks the clinician overrode with "Analyze anyway". */
  overrides: string[];
  /** SHA-256 of the uploaded pixels, for the duplicate check. */
  pixelHash: string;
  width: number;
  height: number;
}

export type ValidUpload = { ok: true; details: UploadDetails; meta: UploadMeta } | { ok: false; reason: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validates and normalizes what the browser sends; never trusts it for anything but labels and counts. */
export function validateUpload(input: { uploadId?: unknown; details?: unknown; meta?: unknown; contribution?: unknown }): ValidUpload {
  if (typeof input.uploadId !== "string" || !UPLOAD_ID.test(input.uploadId)) return { ok: false, reason: "uploadId is invalid." };
  if (input.contribution !== true) return { ok: false, reason: "Confirm the research contribution for this image." };
  const d = (input.details ?? {}) as Record<string, unknown>;
  const m = (input.meta ?? {}) as Record<string, unknown>;
  const label = str(d.label, 60);
  if (!label) return { ok: false, reason: "Add a patient label." };
  if (RESERVED_LABEL.test(label)) return { ok: false, reason: "Reserved for sample studies." };
  // Ages over 89 are identifiers under the usual de-identification rules:
  // stored as 90, shown as "90+".
  const age = typeof d.age === "number" && Number.isFinite(d.age) && d.age >= 0 && d.age <= 120 ? Math.min(AGE_TOP, Math.round(d.age)) : null;
  const sex = d.sex === "F" || d.sex === "M" ? d.sex : null;
  const view = d.view === "PA" || d.view === "AP" ? d.view : null;
  const format = m.format === "dicom" || m.format === "jpeg" || m.format === "png" ? m.format : null;
  if (!format) return { ok: false, reason: "Unsupported format." };
  const box = (b: unknown) => {
    const r = b as Record<string, unknown>;
    const n = (k: string) => (typeof r?.[k] === "number" ? Math.max(0, Math.min(1, r[k] as number)) : 0);
    return { x: n("x"), y: n("y"), w: n("w"), h: n("h") };
  };
  const kept = Object.fromEntries(
    Object.entries((m.kept ?? {}) as Record<string, unknown>)
      .filter(([k, v]) => /^[a-zA-Z]{2,24}$/.test(k) && typeof v === "string")
      .slice(0, 10)
      .map(([k, v]) => [k, String(v).slice(0, 40)]),
  );
  return {
    ok: true,
    details: { label, age, sex, view, indication: str(d.indication, 300) },
    meta: {
      format,
      removedTags: typeof m.removedTags === "number" ? Math.max(0, Math.min(500, Math.round(m.removedTags))) : 0,
      kept,
      redactions: Array.isArray(m.redactions) ? m.redactions.slice(0, 10).map(box) : [],
      textKept: m.textKept === true,
      overrides: Array.isArray(m.overrides) ? m.overrides.filter((o): o is string => typeof o === "string").slice(0, 6).map((o) => o.slice(0, 40)) : [],
      pixelHash: typeof m.pixelHash === "string" && /^[a-f0-9]{64}$/.test(m.pixelHash) ? m.pixelHash : "",
      width: typeof m.width === "number" ? Math.round(m.width) : 0,
      height: typeof m.height === "number" ? Math.round(m.height) : 0,
    },
  };
}

/** "dicom · 14 tags removed · 1 area redacted · kept: quality" for the Received trace row. */
export function describeUpload(meta: UploadMeta): string {
  return [
    meta.format,
    meta.format === "dicom" ? `${meta.removedTags} identifying tags removed in the browser` : "metadata removed in the browser",
    meta.redactions.length ? `${meta.redactions.length} text area${meta.redactions.length === 1 ? "" : "s"} redacted` : meta.textKept ? "flagged text kept as not identifying" : "no text on film",
    meta.overrides.length ? `analyzed anyway: ${meta.overrides.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
