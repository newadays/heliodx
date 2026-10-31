/**
 * Whether a finding needs attention: the model's own label when it gave one,
 * otherwise whether it cites a measurement that crossed its threshold. Shared
 * by the web app (the "N need attention" verdict) and the eval grading (E10).
 */
export type Polarity = "normal" | "attention";

export function findingPolarity(
  f: { polarity?: Polarity | null; evidence?: { measurementIds?: string[] } | null },
  flaggedMeasurementIds: Iterable<string>,
): Polarity {
  if (f.polarity) return f.polarity;
  const flagged = new Set(flaggedMeasurementIds);
  return (f.evidence?.measurementIds ?? []).some((id) => flagged.has(id)) ? "attention" : "normal";
}
