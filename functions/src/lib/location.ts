/**
 * B25 · Reads the model's free-text `location` ("right lung upper zone",
 * "both lungs upper zones", "heart"). Never trusted beyond this: unknown text
 * gives no sides, and the observation falls back to its cited region.
 */
export type Side = "left" | "right";
export type Zone = "upper" | "middle" | "lower";

export interface ParsedLocation {
  sides: Side[];
  zone: Zone | null;
  heart: boolean;
}

export function parseLocation(text: string | null | undefined): ParsedLocation {
  const t = ` ${(text ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  const both = /\b(both|bilateral|bilaterally)\b/.test(t);
  const sides: Side[] = both
    ? ["right", "left"]
    : ([/\bright\b/.test(t) ? "right" : null, /\bleft\b/.test(t) ? "left" : null].filter(Boolean) as Side[]);
  const zone: Zone | null = /\b(upper|apex|apical|apices)\b/.test(t)
    ? "upper"
    : /\b(middle|mid)\b/.test(t)
      ? "middle"
      : /\b(lower|base|basal|bases)\b/.test(t)
        ? "lower"
        : null;
  const heart = /\b(heart|cardiac)\b/.test(t);
  return { sides, zone, heart };
}
