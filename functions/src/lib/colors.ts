/** Finding colours, set at draft time. */
export const FINDING_COLORS = ["#F5B400", "#4A90E2", "#34C759", "#AF52DE", "#FF6B6B", "#5AC8FA"] as const;

export function findingColor(index: number): string {
  const n = FINDING_COLORS.length;
  return FINDING_COLORS[((Math.trunc(index) % n) + n) % n];
}
