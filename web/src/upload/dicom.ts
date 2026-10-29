/**
 * §5.10 · DICOM in the browser: read the tags, list the identifying ones
 * (PS3.15 basic profile, the common set) and the attributes we keep, and
 * decode uncompressed pixels to 8-bit greyscale with rescale, windowing and
 * MONOCHROME1 inversion. Nothing here sends anything; only the decoded
 * pixels are ever uploaded, so every tag stays on this machine.
 */
import dicomParser from "dicom-parser";

/** Identifying attributes (PS3.15 basic profile, common subset): tag → label. */
export const IDENTIFYING: Record<string, string> = {
  x00100010: "Patient name",
  x00100020: "Patient ID",
  x00100030: "Birth date",
  x00100032: "Birth time",
  x00100040: "Patient sex",
  x00101010: "Patient age",
  x00101000: "Other patient IDs",
  x00101001: "Other patient names",
  x00101040: "Patient address",
  x00102154: "Patient telephone",
  x00080050: "Accession number",
  x00080080: "Institution name",
  x00080081: "Institution address",
  x00080090: "Referring physician",
  x00081040: "Department",
  x00081050: "Performing physician",
  x00081070: "Operator",
  x00081010: "Station name",
  x00181000: "Device serial number",
  x00080020: "Study date",
  x00080021: "Series date",
  x00080022: "Acquisition date",
  x00080023: "Content date",
  x00080030: "Study time",
  x00200010: "Study ID",
  x0020000d: "Study instance UID",
  x0020000e: "Series instance UID",
  x00080018: "SOP instance UID",
  x00321032: "Requesting physician",
  x00400275: "Request attributes",
};

const KEPT: Record<string, string> = {
  x00080060: "modality",
  x00180015: "bodyPart",
  x00185101: "viewPosition",
  x00280004: "photometric",
};

const UNCOMPRESSED = new Set(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"]);

export class DicomError extends Error {}

export interface DicomResult {
  width: number;
  height: number;
  /** 8-bit greyscale, row-major. */
  pixels: Uint8ClampedArray;
  /** Labels of the identifying attributes present (never uploaded). */
  removed: string[];
  /** Private (vendor) tags present, also never uploaded. */
  privateTags: number;
  kept: Record<string, string>;
  /** Prefills for the details form (stay in the browser unless the person keeps them). */
  hints: { age: number | null; sex: "F" | "M" | null; view: "PA" | "AP" | null };
  pixelSpacing: string | null;
}

export function isDicom(bytes: Uint8Array): boolean {
  return bytes.length > 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4d;
}

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function parseDicom(bytes: Uint8Array): DicomResult {
  let ds: dicomParser.DataSet;
  try {
    ds = dicomParser.parseDicom(bytes);
  } catch {
    throw new DicomError("This DICOM file can't be read.");
  }
  const ts = ds.string("x00020010")?.trim() ?? "1.2.840.10008.1.2.1";
  if (!UNCOMPRESSED.has(ts)) throw new DicomError("Compressed DICOM isn't supported yet. Export as uncompressed DICOM, JPEG or PNG.");
  const width = ds.uint16("x00280011") ?? 0;
  const height = ds.uint16("x00280010") ?? 0;
  const bits = ds.uint16("x00280100") ?? 16;
  const signed = ds.uint16("x00280103") === 1;
  const samples = ds.uint16("x00280002") ?? 1;
  const el = ds.elements.x7fe00010;
  if (!el || !width || !height) throw new DicomError("This DICOM file has no image.");
  if (samples !== 1) throw new DicomError("Colour DICOM isn't supported. Export the X-ray as greyscale.");
  const n = width * height;
  const slope = Number(ds.string("x00281053") ?? 1) || 1;
  const intercept = Number(ds.string("x00281052") ?? 0) || 0;
  const raw = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset + el.dataOffset, Math.min(el.length, bytes.length - el.dataOffset));
  const little = ts !== "1.2.840.10008.1.2.2";
  for (let i = 0; i < n; i++) {
    let v: number;
    if (bits === 8) v = signed ? view.getInt8(i) : view.getUint8(i);
    else v = signed ? view.getInt16(i * 2, little) : view.getUint16(i * 2, little);
    raw[i] = v * slope + intercept;
  }
  const center = Number((ds.string("x00281050") ?? "").split("\\")[0]);
  const wwidth = Number((ds.string("x00281051") ?? "").split("\\")[0]);
  let lo: number;
  let hi: number;
  if (Number.isFinite(center) && Number.isFinite(wwidth) && wwidth > 1) {
    lo = center - wwidth / 2;
    hi = center + wwidth / 2;
  } else {
    const step = Math.max(1, Math.floor(n / 200_000));
    const sample = new Float32Array(Math.ceil(n / step));
    for (let i = 0, j = 0; i < n; i += step, j++) sample[j] = raw[i];
    sample.sort();
    lo = percentile(sample, 0.005);
    hi = percentile(sample, 0.995);
  }
  const invert = (ds.string("x00280004") ?? "").trim() === "MONOCHROME1";
  const pixels = new Uint8ClampedArray(n);
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    const v = ((raw[i] - lo) / span) * 255;
    pixels[i] = invert ? 255 - v : v;
  }

  const removed = Object.entries(IDENTIFYING)
    .filter(([tag]) => ds.elements[tag] && ds.elements[tag].length > 0)
    .map(([, label]) => label);
  const privateTags = Object.keys(ds.elements).filter((t) => parseInt(t.slice(1, 5), 16) % 2 === 1).length;
  const kept: Record<string, string> = {};
  for (const [tag, key] of Object.entries(KEPT)) {
    const v = ds.string(tag)?.trim();
    if (v) kept[key] = v;
  }
  const ageStr = ds.string("x00101010")?.trim() ?? "";
  const ageMatch = /^(\d{1,3})Y$/.exec(ageStr);
  const sex = ds.string("x00100040")?.trim();
  const vp = kept.viewPosition?.toUpperCase();
  return {
    width,
    height,
    pixels,
    removed,
    privateTags,
    kept,
    hints: { age: ageMatch ? Number(ageMatch[1]) : null, sex: sex === "F" || sex === "M" ? sex : null, view: vp === "PA" || vp === "AP" ? vp : null },
    pixelSpacing: ds.string("x00280030")?.trim() ?? null,
  };
}
