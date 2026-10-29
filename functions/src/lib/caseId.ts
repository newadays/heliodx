/**
 * B21 + §4.11 · Short readable case ids, prefixed by source: `U-7K2P` for
 * uploads, `S-AI2Y7` for samples. Characters come from an alphabet without
 * look-alikes (no 0/O, 1/I/L). Each id is reserved in `caseIds` with a
 * create-only write, so ids are unique per organization and never reused,
 * even after the study is deleted.
 */
import type { Firestore } from "firebase-admin/firestore";

export const CASE_ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type CaseSource = "upload" | "sample";

const SHAPE: Record<CaseSource, { prefix: string; length: number }> = {
  upload: { prefix: "U-", length: 4 },
  sample: { prefix: "S-", length: 5 },
};

export function newCaseId(source: CaseSource, random: () => number = Math.random): string {
  const { prefix, length } = SHAPE[source];
  let id = prefix;
  for (let i = 0; i < length; i++) id += CASE_ID_ALPHABET[Math.floor(random() * CASE_ID_ALPHABET.length)];
  return id;
}

export async function uniqueCaseId(db: Firestore, orgId: string, source: CaseSource, random: () => number = Math.random): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = newCaseId(source, random);
    try {
      await db.collection("caseIds").doc(`${orgId}_${id}`).create({ orgId, caseId: id, at: new Date() });
      return id;
    } catch (error) {
      // ALREADY_EXISTS: taken (or used by a deleted study); draw again.
      if ((error as { code?: number }).code !== 6) throw error;
    }
  }
  throw new Error("case_id_exhausted");
}
