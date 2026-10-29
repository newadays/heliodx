/** Epoch ms of a Firestore Timestamp field; 0 when missing or still a pending serverTimestamp(). */
export function tsToMillis(value: unknown): number {
  const ts = value as { toMillis?: () => number } | null | undefined;
  return typeof ts?.toMillis === "function" ? ts.toMillis() : 0;
}
