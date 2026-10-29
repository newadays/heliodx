/**
 * Shared setup for the security-rules suites. Requires the emulators;
 * run via `npm run test:rules` which wraps vitest in `firebase emulators:exec`
 * so FIRESTORE_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST are set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
  type TokenOptions,
} from "@firebase/rules-unit-testing";

export const PROJECT_ID = "heliodx-rules-test";
export const ORG_A = "kubi-medical";
export const ORG_B = "other-clinic";
export const UID_A1 = "uid-a1"; // clinician in org A
export const UID_A2 = "uid-a2"; // a second clinician in org A
export const UID_B1 = "uid-b1"; // clinician in org B
export const UID_UNBOUND = "uid-unbound"; // signed in, no orgId claim

function hostPort(envVar: string, fallbackPort: number): { host: string; port: number } {
  const raw = process.env[envVar];
  if (!raw) return { host: "127.0.0.1", port: fallbackPort };
  const [host, port] = raw.split(":");
  return { host, port: Number(port) };
}

export async function setupEnv(): Promise<RulesTestEnvironment> {
  const root = resolve(__dirname, "..", "..", "..");
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(root, "firestore.rules"), "utf8"),
      ...hostPort("FIRESTORE_EMULATOR_HOST", 8080),
    },
    storage: {
      rules: readFileSync(resolve(root, "storage.rules"), "utf8"),
      ...hostPort("FIREBASE_STORAGE_EMULATOR_HOST", 9199),
    },
  });
}

export function member(
  env: RulesTestEnvironment,
  uid: string,
  orgId: string,
  role: "clinician" | "radiologist" | "admin" | "demo" = "clinician",
): RulesTestContext {
  const token: TokenOptions = { email: `${uid}@${orgId}.test`, orgId, role };
  return env.authenticatedContext(uid, token);
}

export function unbound(env: RulesTestEnvironment, uid = UID_UNBOUND): RulesTestContext {
  return env.authenticatedContext(uid, { email: `${uid}@nowhere.test` });
}

/** A minimal valid study shell, as the client creates it before upload. */
export function studyShell(orgId: string, clinicianUid: string) {
  return {
    orgId,
    clinicianUid,
    clinicianName: "A. Smith",
    patient: { name: "Jane Doe" },
    modality: "xray",
    studyType: "",
    clinicalContext: "",
    source: "camera",
    image: {
      storagePath: `studies/${orgId}/${clinicianUid}/s1/original.jpg`,
      thumbPath: null,
      width: 0,
      height: 0,
      bytes: 0,
      contentType: "image/jpeg",
    },
    status: "uploading",
    pipeline: { runId: null, stepTimestamps: {} },
    findings: [],
    clinicianSummary: null,
    patientSummary: null,
    reviewHash: null,
    shares: [],
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
