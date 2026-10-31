/**
 * Image preparation for the pipeline: download the original, normalise
 * orientation, make a ≤2048 px JPEG for the model and a 512 px thumbnail
 * for the app's lists. The thumbnail is written next to the original.
 */
import { getStorage } from "firebase-admin/storage";
import sharp, { type OutputInfo, type Sharp } from "sharp";

import { LIMITS } from "../config";

export interface PreparedImages {
  model: { data: Buffer; mimeType: "image/jpeg"; width: number; height: number };
  /** Dimensions of the original as stored. */
  original: { width: number; height: number; bytes: number };
  thumbPath: string;
}

/** The copy every model and SAM sees: at most 2048 px, JPEG. The eval runner uses it too. */
export function modelCopy(image: Sharp): Promise<{ data: Buffer; info: OutputInfo }> {
  return image
    .resize({ width: LIMITS.modelImageMaxPx, height: LIMITS.modelImageMaxPx, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
}

export async function prepareImages(bucketName: string, objectPath: string): Promise<PreparedImages> {
  const bucket = getStorage().bucket(bucketName);
  const [buffer] = await bucket.file(objectPath).download();

  const base = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const original = { width: meta.width ?? 0, height: meta.height ?? 0, bytes: buffer.length };

  const modelBuf = await modelCopy(base.clone());

  const thumbBuf = await base
    .clone()
    .resize({ width: LIMITS.thumbMaxPx, height: LIMITS.thumbMaxPx, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const thumbPath = objectPath.replace(/original\.[a-z0-9]+$/i, "thumb.jpg");
  await bucket.file(thumbPath).save(thumbBuf, {
    contentType: "image/jpeg",
    resumable: false,
    metadata: { cacheControl: "private, max-age=86400" },
  });

  return {
    model: { data: modelBuf.data, mimeType: "image/jpeg", width: modelBuf.info.width, height: modelBuf.info.height },
    original,
    thumbPath,
  };
}
