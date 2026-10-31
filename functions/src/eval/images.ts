/**
 * E1 · The image each task runs on. Intake variants are built from the film
 * here, so their ground truth comes from how they were made: a heavy blur
 * (Laplacian variance far below QUALITY_LIMITS.minSharpness), a copy below
 * the minimum long edge, and two synthetic non-medical pictures.
 */
import sharp, { type Sharp } from "sharp";

import { modelCopy } from "../pipeline/image";
import { QUALITY_LIMITS } from "../schemas/thresholds";
import type { IntakeVariant } from "./types";

/** NIH films are 1024 px; sigma 6 there is about sigma 12 at 2048 px, well past the blur limit. */
export const BLUR_SIGMA = 6;
export const LOWRES_PX = Math.round(QUALITY_LIMITS.minLongEdgePx * 0.75);

const NON_MEDICAL_SVG = [
  // A landscape: sky, sun, two hills.
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b82c4"/><stop offset="1" stop-color="#cfe6f7"/></linearGradient></defs>
    <rect width="1024" height="768" fill="url(#s)"/><circle cx="800" cy="160" r="70" fill="#ffd34d"/>
    <ellipse cx="300" cy="760" rx="520" ry="260" fill="#4f8f3a"/><ellipse cx="820" cy="790" rx="480" ry="230" fill="#3d7a2c"/>
    <rect x="140" y="470" width="26" height="90" fill="#6b4a2b"/><circle cx="153" cy="440" r="60" fill="#2f6b23"/>
  </svg>`,
  // A printed page: heading bar and lines of text blocks.
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1040">
    <rect width="800" height="1040" fill="#f7f5ef"/><rect x="80" y="90" width="420" height="34" fill="#2b2b2b"/>
    ${Array.from({ length: 22 }, (_, i) => `<rect x="80" y="${170 + i * 36}" width="${560 - ((i * 53) % 180)}" height="12" fill="#55524c"/>`).join("")}
  </svg>`,
];

/** The model copy (≤2048 px JPEG) for a task, exactly as the pipeline would make it. */
export async function taskImage(film: Buffer | null, variant: IntakeVariant | undefined, nonMedicalIndex = 1): Promise<Buffer> {
  let img: Sharp;
  if (variant === "nonmedical" || !film) {
    img = sharp(Buffer.from(NON_MEDICAL_SVG[(nonMedicalIndex - 1) % NON_MEDICAL_SVG.length])).flatten({ background: "#ffffff" });
  } else if (variant === "blur") {
    img = sharp(film, { failOn: "none" }).rotate().blur(BLUR_SIGMA);
  } else if (variant === "lowres") {
    img = sharp(await sharp(film, { failOn: "none" }).rotate().resize({ width: LOWRES_PX, height: LOWRES_PX, fit: "inside" }).toBuffer());
  } else {
    img = sharp(film, { failOn: "none" }).rotate();
  }
  return (await modelCopy(img)).data;
}
