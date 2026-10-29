/**
 * Review bookkeeping for a study's findings.
 *
 * `reviewHash` is a stable fingerprint of what the clinician decided
 * (`id`, `status`, `editedText` per finding, in id order). The summaries
 * record the hash they were generated from, so the app knows when a review
 * changed after drafting and the summaries need regenerating.
 *
 * Dependency-free so it runs under alias-free Vitest and in Functions alike.
 */

export interface ReviewableFinding {
  id: string;
  status: "pending" | "accepted" | "edited" | "rejected";
  editedText?: string | null;
}

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex chars. Stable across platforms. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function reviewHash(findings: readonly ReviewableFinding[]): string {
  const canonical = [...findings]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => `${f.id}\u0001${f.status}\u0001${(f.editedText ?? "").trim()}`)
    .join("\u0002");
  return `r1-${fnv1a(canonical)}-${findings.length}`;
}

export interface ReviewProgress {
  /** Findings the clinician has acted on (accepted, edited or rejected). */
  reviewed: number;
  total: number;
  /** Every finding has a decision. */
  complete: boolean;
  /** Findings that will appear in the summaries. */
  included: number;
}

export function reviewProgress(findings: readonly ReviewableFinding[]): ReviewProgress {
  const reviewed = findings.filter((f) => f.status !== "pending").length;
  const included = findings.filter((f) => f.status === "accepted" || f.status === "edited").length;
  return { reviewed, total: findings.length, complete: reviewed === findings.length, included };
}

/** "1 of 3 reviewed" */
export function reviewProgressLabel(p: ReviewProgress): string {
  return `${p.reviewed} of ${p.total} reviewed`;
}

/** Whether the summaries were drafted from a different review than the current one. */
export function summariesStale(
  currentHash: string,
  generatedFromReviewHash: string | null | undefined,
): boolean {
  return !generatedFromReviewHash || generatedFromReviewHash !== currentHash;
}
