/**
 * Translucent PNG overlays for masks, stored next to the study at
 * `studies/{org}/{uid}/{study}/overlays/{maskId}.png` (the owner may read, no
 * client writes). Scaled to at most 1024 px on the long edge: the app
 * stretches overlays over the image, so full resolution only costs bytes.
 */
import { getStorage } from "firebase-admin/storage";
import sharp from "sharp";

import type { MaskRecord } from "./segment";

export const OVERLAY_MAX_PX = 1024;
const ALPHA = Math.round(0.35 * 255);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** PNG of the mask in `color` at 35% opacity; transparent elsewhere. */
export async function renderOverlay(mask: Uint8Array, width: number, height: number, color: string): Promise<Buffer> {
  const [r, g, b] = hexToRgb(color);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = ALPHA;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize({ width: OVERLAY_MAX_PX, height: OVERLAY_MAX_PX, fit: "inside", withoutEnlargement: true, kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Render and store the overlay for a mask; returns its Storage path. */
export async function saveOverlay(
  bucketName: string,
  studyPrefix: string,
  record: MaskRecord,
  mask: Uint8Array,
  color: string,
): Promise<string> {
  const png = await renderOverlay(mask, record.width, record.height, color);
  const path = `${studyPrefix}/overlays/${record.maskId}.png`;
  await getStorage().bucket(bucketName).file(path).save(png, {
    contentType: "image/png",
    resumable: false,
    metadata: { cacheControl: "private, max-age=86400" },
  });
  return path;
}
