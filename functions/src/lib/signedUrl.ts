/**
 * V4 signed read URLs for Storage objects. Signing needs
 * `roles/iam.serviceAccountTokenCreator` for the runtime service account on
 * itself (it fails at call time, not deploy time, when missing). The
 * emulator can't sign without a key, so there it returns a media URL with a
 * download token (like a signed URL, it bypasses the rules) so flows can be
 * exercised locally.
 */
import { randomUUID } from "node:crypto";

import type { File } from "@google-cloud/storage";
import { logger } from "firebase-functions/v2";

import { IS_EMULATOR } from "../config";

export class SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningError";
  }
}

/** `downloadAs` sets the file name the browser saves it under (Content-Disposition: attachment). */
export async function signedReadUrl(file: File, expiresAt: Date, downloadAs?: string): Promise<string> {
  try {
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: expiresAt,
      ...(downloadAs ? { responseDisposition: `attachment; filename="${downloadAs.replace(/[^A-Za-z0-9._-]/g, "")}"` } : {}),
    });
    return url;
  } catch (error) {
    if (IS_EMULATOR) {
      const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "127.0.0.1:9199";
      const token = randomUUID();
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
      logger.warn("signedReadUrl: emulator fallback URL (download token, unsigned)");
      return `http://${host}/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`;
    }
    throw new SigningError(error instanceof Error ? error.message : String(error));
  }
}
