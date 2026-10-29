import { describe, expect, it } from "vitest";

import { mockDraft } from "../src/models/fixtures";
import { FINDING_COLORS } from "../src/lib/colors";
import { boxToRegion, resolveHighlights, toFindings } from "../src/pipeline/convert";

describe("boxToRegion", () => {
  it("converts a [ymin, xmin, ymax, xmax] 0–1000 box to a normalized x/y/w/h", () => {
    expect(boxToRegion([550, 580, 750, 840], "ellipse")).toEqual({ shape: "ellipse", x: 0.58, y: 0.55, w: 0.26, h: 0.2 });
  });

  it("clamps out-of-range values to the image", () => {
    expect(boxToRegion([-50, 900, 1200, 1500], "rect")).toEqual({ shape: "rect", x: 0.9, y: 0, w: 0.1, h: 1 });
  });

  it("returns null for missing, malformed, inverted or sliver boxes", () => {
    expect(boxToRegion(null, "rect")).toBeNull();
    expect(boxToRegion([1, 2, 3], "rect")).toBeNull();
    expect(boxToRegion([500, 500, 400, 600], "rect")).toBeNull();
    expect(boxToRegion([100, 100, 105, 900], "rect")).toBeNull();
    expect(boxToRegion([Number.NaN, 0, 10, 10], "rect")).toBeNull();
  });
});

describe("toFindings", () => {
  it("assigns ids, order, colours and pending status, and clamps confidence", () => {
    const out = toFindings([
      { title: " A ", description: " desc ", confidence: 130, box_2d: [0, 0, 500, 500], shape: "rect" },
      { title: "B", description: "d", confidence: -4, box_2d: null, shape: "ellipse" },
    ]);
    expect(out.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(out[0]).toMatchObject({ index: 0, title: "A", description: "desc", confidence: 100, color: FINDING_COLORS[0], status: "pending", reviewedAt: null });
    expect(out[0].region).toEqual({ shape: "rect", x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(out[1]).toMatchObject({ index: 1, confidence: 0, region: null, color: FINDING_COLORS[1] });
  });

  it("caps at six findings", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, description: "d", confidence: 50, box_2d: null, shape: "rect" as const }));
    expect(toFindings(many)).toHaveLength(6);
  });
});

describe("resolveHighlights", () => {
  const findings = [
    { id: "f1", index: 0, title: "Right lower lobe opacity" },
    { id: "f2", index: 1, title: "Blunted costophrenic angle" },
    { id: "f3", index: 2, title: "Cardiomegaly" },
  ];
  const text = "There is a right lower lobe opacity with a blunted costophrenic angle. No cardiomegaly.";

  it("resolves exact quotes to offsets", () => {
    const h = resolveHighlights(text, findings, [{ findingIndex: 0, quote: "right lower lobe opacity" }]);
    expect(h[0]).toEqual({ findingId: "f1", start: 11, end: 35 });
    expect(text.slice(h[0].start, h[0].end)).toBe("right lower lobe opacity");
  });

  it("falls back to the title (case-insensitive) when the quote is not in the text", () => {
    const h = resolveHighlights(text, findings, [{ findingIndex: 1, quote: "something the model made up" }]);
    const f2 = h.find((x) => x.findingId === "f2")!;
    expect(text.slice(f2.start, f2.end).toLowerCase()).toBe("blunted costophrenic angle");
  });

  it("highlights unquoted findings by title and removes overlaps, earliest first", () => {
    const h = resolveHighlights(text, findings, []);
    expect(h.map((x) => x.findingId)).toEqual(["f1", "f2", "f3"]);
    for (let i = 1; i < h.length; i++) expect(h[i].start).toBeGreaterThanOrEqual(h[i - 1].end);
  });

  it("drops a finding whose title and quote both miss, and ignores unknown indexes", () => {
    const h = resolveHighlights("Nothing here.", findings, [{ findingIndex: 9, quote: "x" }]);
    expect(h).toEqual([]);
  });

  it("round-trips the fixtures", () => {
    const d = mockDraft("xray", "Dr. X");
    const text = d.summaries.clinicianSummary.findings;
    const h = resolveHighlights(text, d.findings, d.findings.map((f) => ({ findingIndex: f.index, quote: f.title })));
    expect(h).toHaveLength(3);
  });
});
