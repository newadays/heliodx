/**
 * Writes and callables used by the screens; every one goes through the
 * backend's rules or callables.
 */
import { FirebaseError } from "firebase/app";
import { collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getBlob, ref } from "firebase/storage";

import type { ClinicianSummary, Finding, PatientSummary, ShareChannel } from "@/types/study";
import { reviewHash } from "@/utils/reviewHash";
import { db, functions, storage } from "~/firebase";
import { saveBlob } from "~/lib/download";

export interface DemoSample {
  id: string;
  title: string;
  storagePath: string;
  age?: number;
  sex?: "F" | "M";
  view?: string;
  indication?: string;
  order: number;
}

export async function listSamples(): Promise<DemoSample[]> {
  const snap = await getDocs(query(collection(db, "samples"), orderBy("order")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DemoSample, "id">) }));
}

export async function createDemoStudy(sampleId: string): Promise<string> {
  const { data } = await httpsCallable<{ sampleId: string }, { studyId: string }>(functions, "createDemoStudy")({ sampleId });
  return data.studyId;
}

export async function retryAnalysis(studyId: string, opts: { analyzeAnyway?: boolean } = {}): Promise<boolean> {
  const { data } = await httpsCallable<{ studyId: string; analyzeAnyway?: boolean }, { started: boolean }>(functions, "retryPipeline")({ studyId, ...opts });
  return data.started;
}

export async function warmModels(): Promise<void> {
  await httpsCallable(functions, "warmModels")({}).catch(() => undefined);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** The whole findings array with its review hash, written together (rules allow it while the study is in review). */
export async function saveFindings(studyId: string, findings: Finding[]): Promise<string> {
  const hash = reviewHash(findings);
  await updateDoc(doc(db, "studies", studyId), {
    findings: findings.map(withoutUndefined),
    reviewHash: hash,
    updatedAt: serverTimestamp(),
  });
  return hash;
}

export type RegenerateResult = { reviewHash: string; clinicianSummary: ClinicianSummary | null; queued?: "gpu_starting" };

/** Redrafts the report now; on a cold GPU the backend queues it (`queued`) and the background drafter writes it once the GPU is up. */
export async function regenerateReport(studyId: string): Promise<RegenerateResult> {
  const { data } = await httpsCallable<{ studyId: string; which: "clinician" }, RegenerateResult>(
    functions,
    "regenerateSummaries",
  )({ studyId, which: "clinician" });
  return data;
}

export async function saveReport(studyId: string, current: ClinicianSummary, value: Pick<ClinicianSummary, "findings" | "impression" | "recommendation">): Promise<void> {
  await updateDoc(doc(db, "studies", studyId), { clinicianSummary: { ...current, ...value, editedByClinician: true }, updatedAt: serverTimestamp() });
}

export type SignNeed = "decide_every_finding" | "request_radiologist_read" | "close_radiologist_read" | "write_impression" | "write_recommendation" | "refresh_summary" | "confirm_impression";

export type SignOutcome = { ok: true; reportHash: string; signedAt: string } | { ok: false; needs: SignNeed[]; message: string };

export function deviceLabel(): string {
  return `web / ${navigator.userAgent.slice(0, 100)}`;
}

export async function signStudy(studyId: string, confirmImpression: boolean): Promise<SignOutcome> {
  try {
    const { data } = await httpsCallable<{ studyId: string; confirmImpression: boolean; device: string }, { reportHash: string; signedAt: string }>(
      functions,
      "signStudy",
    )({ studyId, confirmImpression, device: deviceLabel() });
    return { ok: true, ...data };
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "functions/failed-precondition") {
      const needs = (error as FirebaseError & { details?: { needs?: SignNeed[] } }).details?.needs;
      if (needs?.length) return { ok: false, needs, message: error.message };
    }
    throw error;
  }
}

/** B14: sends the case to a simulated radiologist; the read then appears on the study document. */
export async function requestRadiologistRead(studyId: string): Promise<void> {
  await httpsCallable<{ studyId: string }, { assigned: true }>(functions, "requestRadiologistRead")({ studyId });
}

export async function generatePatientNote(studyId: string): Promise<void> {
  await httpsCallable(functions, "generatePatientSummary")({ studyId });
}

export async function savePatientNote(studyId: string, next: PatientSummary): Promise<void> {
  await updateDoc(doc(db, "studies", studyId), { patientSummary: next, updatedAt: serverTimestamp() });
}

export interface ShareResult {
  shareId: string;
  downloadUrl: string;
  link?: string;
  linkExpiresAt?: string;
}

export type ShareOutcome = { ok: true; result: ShareResult } | { ok: false; needs: string[]; steps: number[] };

export async function shareStudy(input: { studyId: string; channel: ShareChannel; consent: boolean; consentNote?: string }): Promise<ShareOutcome> {
  try {
    const { data } = await httpsCallable<typeof input, ShareResult>(functions, "shareStudy")(input);
    return { ok: true, result: data };
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "functions/failed-precondition") {
      const details = (error as FirebaseError & { details?: { needs?: string[]; steps?: number[] } }).details;
      if (details?.needs?.length) return { ok: false, needs: details.needs, steps: details.steps ?? [] };
    }
    throw error;
  }
}

export interface UploadStart {
  uploadId: string;
  details: { label: string; age: number | null; sex: "F" | "M" | null; view: "PA" | "AP" | null; indication: string };
  meta: {
    format: "dicom" | "jpeg" | "png";
    removedTags: number;
    kept: Record<string, string>;
    redactions: { x: number; y: number; w: number; h: number }[];
    textKept: boolean;
    overrides: string[];
    pixelHash: string;
    width: number;
    height: number;
  };
  contribution: boolean;
}

/** §4.10: turns a staged, de-identified upload into a study; analysis starts on the server. */
export async function startUpload(input: UploadStart): Promise<{ studyId: string; caseId: string }> {
  const { data } = await httpsCallable<UploadStart, { studyId: string; caseId: string }>(functions, "startUpload")(input);
  return data;
}

/** An existing study of this clinician's with the same pixels, for the duplicate check. */
export async function findDuplicate(orgId: string, uid: string, hash: string): Promise<{ id: string; caseId?: string } | null> {
  const snap = await getDocs(query(collection(db, "studies"), where("orgId", "==", orgId), where("clinicianUid", "==", uid), where("upload.pixelHash", "==", hash)));
  const hit = snap.docs.find((d) => !d.get("deletedAt"));
  return hit ? { id: hit.id, caseId: hit.get("caseId") as string | undefined } : null;
}

/** §4.11 · Deletes an unsigned upload and everything drafted from it. */
export async function deleteUpload(studyId: string): Promise<void> {
  await httpsCallable<{ studyId: string }, { deleted: true }>(functions, "deleteUpload")({ studyId });
}

/** §4.11 · Returns a sample to its fresh draft (decisions, signature, note and shares cleared). */
export async function resetSample(studyId: string): Promise<void> {
  await httpsCallable<{ studyId: string }, { reset: true }>(functions, "resetSample")({ studyId });
}

/** §4.11 · The de-identified PNG of an upload, saved as `HelioDX-<caseId>-deidentified.png`. */
export async function downloadDeidentified(storagePath: string, caseId: string): Promise<void> {
  saveBlob(await getBlob(ref(storage, storagePath)), `HelioDX-${caseId}-deidentified.png`);
}
