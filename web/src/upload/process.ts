/**
 * §5.10 · Everything that happens to a file in the browser before upload:
 * sniff by content, decode to a canvas (which drops every tag and photo
 * metadata), check size / greyscale / shape, hash the pixels for duplicates,
 * and redact flagged text. Only the canvas's pixels are ever uploaded.
 */
import { DicomError, isDicom, parseDicom } from "./dicom";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MIN_SHORT_SIDE = 1024;

export type Format = "dicom" | "jpeg" | "png";

export interface Box {
  /** 0–1 of the image. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Decoded {
  format: Format;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  removed: string[];
  privateTags: number;
  kept: Record<string, string>;
  hints: { age: number | null; sex: "F" | "M" | null; view: "PA" | "AP" | null };
  /** Checks a person may override with "Analyze anyway". */
  issues: { key: string; text: string }[];
}

export class FileProblem extends Error {}

export function sniff(bytes: Uint8Array): Format | null {
  if (isDicom(bytes)) return "dicom";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

function greyCanvas(width: number, height: number, pixels: Uint8ClampedArray): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  for (let i = 0, j = 0; i < pixels.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = pixels[i];
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Fraction of sampled pixels whose channels differ: a colour photo, not an X-ray. */
function colourFraction(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor(data.length / 4 / 50_000)) * 4;
  let coloured = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) coloured++;
    total++;
  }
  return total ? coloured / total : 0;
}

export async function decodeFile(file: File): Promise<Decoded> {
  if (file.size > MAX_FILE_BYTES) throw new FileProblem("Over 50 MB. Export a smaller file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniff(bytes);
  if (!format) throw new FileProblem("Unsupported format. Use JPEG, PNG or DICOM (.dcm).");
  let canvas: HTMLCanvasElement;
  let removed: string[] = [];
  let privateTags = 0;
  let kept: Record<string, string> = {};
  let hints: Decoded["hints"] = { age: null, sex: null, view: null };
  if (format === "dicom") {
    try {
      const d = parseDicom(bytes);
      canvas = greyCanvas(d.width, d.height, d.pixels);
      removed = d.removed;
      privateTags = d.privateTags;
      kept = { ...d.kept, imageSize: `${d.width} × ${d.height}`, ...(d.pixelSpacing ? { pixelSpacing: d.pixelSpacing } : {}) };
      hints = d.hints;
    } catch (error) {
      throw new FileProblem(error instanceof DicomError ? error.message : "This DICOM file can't be read.");
    }
  } else {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }));
    } catch {
      throw new FileProblem("This image can't be decoded.");
    }
    canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    kept = { imageSize: `${canvas.width} × ${canvas.height}` };
  }
  const issues: Decoded["issues"] = [];
  if (format !== "dicom" && colourFraction(canvas.getContext("2d")!, canvas.width, canvas.height) > 0.05) {
    issues.push({ key: "colour image", text: "This looks like a colour photo, not an X-ray. HelioDX reads chest X-rays." });
  }
  const short = Math.min(canvas.width, canvas.height);
  if (short < MIN_SHORT_SIDE) issues.push({ key: "image small", text: `The image is small (${canvas.width} × ${canvas.height}). HelioDX reads best at 1024 px or more on the short side.` });
  const ratio = canvas.width / canvas.height;
  if (ratio < 0.6 || ratio > 1.7) issues.push({ key: "unusual shape", text: "The image has an unusual shape and may be cropped. HelioDX reads full frontal (PA/AP) chest X-rays." });
  return { format, canvas, width: canvas.width, height: canvas.height, removed, privateTags, kept, hints, issues };
}

/** SHA-256 of a 256 × 256 greyscale thumbnail: the same film uploaded twice hashes the same. */
export async function pixelHash(canvas: HTMLCanvasElement): Promise<string> {
  const small = document.createElement("canvas");
  small.width = 256;
  small.height = 256;
  const ctx = small.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, 256, 256);
  const data = ctx.getImageData(0, 0, 256, 256).data;
  const grey = new Uint8Array(256 * 256);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = Math.round((data[i] + data[i + 1] + data[i + 2]) / 3) >> 2;
  const digest = await crypto.subtle.digest("SHA-256", grey);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fills each box with black in the pixels themselves (the redacted image is what gets stored). */
export function redact(canvas: HTMLCanvasElement, boxes: Box[]): void {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  for (const b of boxes) ctx.fillRect(Math.floor(b.x * canvas.width), Math.floor(b.y * canvas.height), Math.ceil(b.w * canvas.width), Math.ceil(b.h * canvas.height));
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
}

export function thumbUrl(canvas: HTMLCanvasElement, size = 112): string {
  const t = document.createElement("canvas");
  const scale = size / Math.max(canvas.width, canvas.height);
  t.width = Math.round(canvas.width * scale);
  t.height = Math.round(canvas.height * scale);
  t.getContext("2d")!.drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.8);
}
