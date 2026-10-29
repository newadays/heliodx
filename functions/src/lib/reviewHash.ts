/**
 * Mirror of the app's utils/reviewHash.ts. Both sides must agree byte for
 * byte: the app decides whether the summaries are stale by comparing its
 * hash with the `generatedFromReviewHash` this side stamps.
 * test/reviewHash.test.ts pins a vector shared with the app's test.
 */
export interface ReviewableFinding {
  id: string;
  status: "pending" | "accepted" | "edited" | "rejected";
  editedText?: string | null;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The review hash the clinician produces by accepting every finding
 * unchanged. The analysis-time report is drafted from all findings, so it is
 * current for exactly that review: accept all → sign, with no redraft.
 */
export function acceptAllHash(findings: readonly Pick<ReviewableFinding, "id">[]): string {
  return reviewHash(findings.map((f) => ({ id: f.id, status: "accepted" as const, editedText: null })));
}

export function reviewHash(findings: readonly ReviewableFinding[]): string {
  const canonical = [...findings]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => `${f.id}\u0001${f.status}\u0001${(f.editedText ?? "").trim()}`)
    .join("\u0002");
  return `r1-${fnv1a(canonical)}-${findings.length}`;
}
